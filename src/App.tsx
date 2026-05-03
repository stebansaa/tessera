import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { TabBar } from "./components/TabBar";
import { StatusBar, type TransferStatus } from "./components/StatusBar";
import { SessionPanel, type PanelMode } from "./components/SessionPanel";
import {
  BriefPanel,
  type BriefMode,
  type BriefPanelState,
} from "./components/BriefPanel";
import { api } from "./lib/api";
import type { TerminalTransferEvent } from "./components/TerminalView";
import type { BriefSettings, BriefSummary, BriefTerminalEvent, Session, TabType } from "./shared/ipc";

interface Tab {
  id: string;
  name: string;
  type: TabType;
  url?: string;
}

/**
 * The right-side content can be in four states:
 *
 *   - { kind: 'session', sessionId } — show the active session's pane
 *   - { kind: 'create' }              — show the new-session form
 *   - { kind: 'edit', sessionId }     — show the form pre-filled for edit
 *   - { kind: 'themes' }              — show the themes settings page
 *
 * Sidebar session selection switches to 'session'. The "+ New session" button
 * switches to 'create'. The settings icon in the tab row switches to 'edit'.
 * The "Themes" sidebar footer entry switches to 'themes'.
 */
type View =
  | { kind: "session"; sessionId: string | null }
  | { kind: "create" }
  | { kind: "edit"; sessionId: string }
  | { kind: "themes" };

/**
 * Build sidebar data: PINNED at top, then all unpinned sessions sorted
 * by most recently used.
 */
function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** Pinned first (by position), then unpinned (by position).
 *  Only terminal connections (local/ssh) — webview and llm are tab types. */
function buildSidebar(sessions: Session[]): Session[] {
  const conns = sessions.filter((s) => s.kind === "local" || s.kind === "ssh");

  const pinned = conns
    .filter((s) => s.pinnedAt !== null)
    .sort((a, b) => a.position - b.position);

  const unpinned = conns
    .filter((s) => s.pinnedAt === null)
    .sort((a, b) => a.position - b.position);

  return [...pinned, ...unpinned];
}

const BRIEF_AUTO_INTERVAL_MS = 30_000;
const BRIEF_MIN_BATCH_EVENTS = 6;
const BRIEF_MIN_BATCH_CHARS = 2_500;
const BRIEF_MAX_EVENTS = 80;
const BRIEF_MAX_CHARS = 50_000;
const BRIEF_MAX_EVENT_CHARS = 8_000;
const TRANSFER_FLUSH_MS = 150;
const TRANSFER_IDLE_MS = 900;
const TRANSFER_HIDE_MS = 1_800;
const TRANSFER_MIN_VISIBLE_BYTES = 64;

interface TransferAccumulator {
  direction: TransferStatus["direction"] | null;
  bytes: number;
  active: boolean;
  flushTimer: number | null;
  idleTimer: number | null;
  hideTimer: number | null;
}

function emptyBriefState(): BriefPanelState {
  return {
    mode: "paused",
    summary: null,
    pendingCount: 0,
    error: null,
    observedSince: null,
  };
}

function withBriefDefaults(state: BriefPanelState | undefined): BriefPanelState {
  return state ?? emptyBriefState();
}

function trimBriefBuffer(events: BriefTerminalEvent[]): BriefTerminalEvent[] {
  let totalChars = 0;
  const kept: BriefTerminalEvent[] = [];
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    totalChars += event.text.length;
    if (kept.length >= BRIEF_MAX_EVENTS || totalChars > BRIEF_MAX_CHARS) break;
    kept.unshift(event);
  }
  return kept;
}

function bufferChars(events: BriefTerminalEvent[]): number {
  return events.reduce((sum, event) => sum + event.text.length, 0);
}

function resolveBriefReturnMode(
  currentMode: BriefMode | undefined,
  returnMode: BriefMode,
): BriefMode {
  return currentMode === "paused" ? "paused" : returnMode;
}

function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [view, setView] = useState<View>({ kind: "session", sessionId: null });
  // Remember the last session the user was actually looking at, so that
  // cancelling out of the create form (when nothing was selected before)
  // returns to that session instead of an empty pane.
  const [lastSessionId, setLastSessionId] = useState<string | null>(null);

  // Tabs are scoped per session. Each session keeps its own list of
  // terminal tabs and its own active-tab pointer; switching sessions in
  // the sidebar swaps in that session's tab state. Sessions get one
  // default tab the first time they're opened.
  //
  // The full state is persisted to SQLite via the settings IPC, so the
  // user reopens the app to the same tabs they had before. PTYs do not
  // survive a relaunch in Phase 1 — each tab still spawns a fresh shell
  // on remount; only the UI state is restored.
  const [tabsBySession, setTabsBySession] = useState<Record<string, Tab[]>>(
    {},
  );
  const [activeTabBySession, setActiveTabBySession] = useState<
    Record<string, string>
  >({});
  const tabsBySessionRef = useRef<Record<string, Tab[]>>({});
  const activeTabBySessionRef = useRef<Record<string, string>>({});
  // Gates the auto-seed effect — we don't want to create a default tab
  // and overwrite the saved state before it has loaded from SQLite.
  const [tabsLoaded, setTabsLoaded] = useState(false);

  // Sessions the user has visited at least once during this app run.
  // SessionPanel keeps a TerminalView mounted for each one so switching
  // away from a session doesn't drop its PTY/SSH connection — coming
  // back to it picks up the live process. This list only grows during a
  // run; it intentionally does not persist across relaunches (PTYs don't
  // either, in Phase 1).
  const [openSessionIds, setOpenSessionIds] = useState<string[]>([]);
  const markOpen = (id: string) => {
    setOpenSessionIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };

  // Per-session live connection count, pushed from main.
  const [connStatus, setConnStatus] = useState<Record<string, number>>({});
  const tabsSaveQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Live brief state is deliberately in-memory. Only the OpenRouter API key
  // is persisted, encrypted by main through Electron safeStorage.
  const [briefSettings, setBriefSettings] = useState<BriefSettings | null>(null);
  const [briefs, setBriefs] = useState<Record<string, BriefPanelState>>({});
  const [briefEnabledBySession, setBriefEnabledBySession] = useState<Record<string, boolean>>({});
  const briefBuffersRef = useRef<Record<string, BriefTerminalEvent[]>>({});
  const briefModesRef = useRef<Record<string, BriefMode>>({});
  const briefSummariesRef = useRef<Record<string, BriefSummary | null>>({});
  const briefSettingsRef = useRef<BriefSettings | null>(null);
  const briefEnabledRef = useRef<Record<string, boolean>>({});
  const briefInFlightRef = useRef<Record<string, boolean>>({});
  const briefUiUpdateRef = useRef<Record<string, number>>({});
  const sessionsRef = useRef<Session[]>([]);
  const [transferStatus, setTransferStatus] = useState<TransferStatus | null>(null);
  const transferAccumulatorRef = useRef<TransferAccumulator>({
    direction: null,
    bytes: 0,
    active: false,
    flushTimer: null,
    idleTimer: null,
    hideTimer: null,
  });

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    const modes: Record<string, BriefMode> = {};
    for (const [sessionId, state] of Object.entries(briefs)) {
      modes[sessionId] = state.mode;
    }
    briefModesRef.current = modes;
  }, [briefs]);

  useEffect(() => {
    briefSettingsRef.current = briefSettings;
  }, [briefSettings]);

  useEffect(() => {
    briefEnabledRef.current = briefEnabledBySession;
  }, [briefEnabledBySession]);

  const patchBrief = useCallback((
    sessionId: string,
    patch: Partial<BriefPanelState>,
  ) => {
    setBriefs((prev) => ({
      ...prev,
      [sessionId]: {
        ...withBriefDefaults(prev[sessionId]),
        ...patch,
      },
    }));
  }, []);

  const handleBriefSettingsChanged = useCallback((settings: BriefSettings) => {
    briefSettingsRef.current = settings;
    setBriefSettings(settings);
  }, []);

  const handleTerminalTransfer = useCallback((event: TerminalTransferEvent) => {
    if (event.bytes <= 0) return;

    const bucket = transferAccumulatorRef.current;
    if (!bucket.active && event.bytes < TRANSFER_MIN_VISIBLE_BYTES) return;

    if (!bucket.active || bucket.direction !== event.direction) {
      bucket.direction = event.direction;
      bucket.bytes = 0;
      bucket.active = true;
    }

    bucket.bytes += event.bytes;

    if (bucket.hideTimer !== null) {
      window.clearTimeout(bucket.hideTimer);
      bucket.hideTimer = null;
    }

    if (bucket.flushTimer === null) {
      bucket.flushTimer = window.setTimeout(() => {
        bucket.flushTimer = null;
        if (!bucket.direction) return;
        setTransferStatus({
          direction: bucket.direction,
          bytes: bucket.bytes,
          active: true,
        });
      }, TRANSFER_FLUSH_MS);
    }

    if (bucket.idleTimer !== null) {
      window.clearTimeout(bucket.idleTimer);
    }
    bucket.idleTimer = window.setTimeout(() => {
      bucket.idleTimer = null;
      bucket.active = false;
      setTransferStatus((current) =>
        current ? { ...current, active: false } : current,
      );
      bucket.hideTimer = window.setTimeout(() => {
        bucket.hideTimer = null;
        if (bucket.active) return;
        bucket.direction = null;
        bucket.bytes = 0;
        setTransferStatus(null);
      }, TRANSFER_HIDE_MS);
    }, TRANSFER_IDLE_MS);
  }, []);

  useEffect(() => {
    return () => {
      const bucket = transferAccumulatorRef.current;
      if (bucket.flushTimer !== null) window.clearTimeout(bucket.flushTimer);
      if (bucket.idleTimer !== null) window.clearTimeout(bucket.idleTimer);
      if (bucket.hideTimer !== null) window.clearTimeout(bucket.hideTimer);
    };
  }, []);

  const refreshBriefConfigForSession = useCallback(
    async (sessionId: string) => {
      const details = await api.sessions.getDetails({ id: sessionId });
      const enabled = details?.terminal?.liveBriefEnabled === true;
      briefEnabledRef.current = {
        ...briefEnabledRef.current,
        [sessionId]: enabled,
      };
      setBriefEnabledBySession((prev) => ({
        ...prev,
        [sessionId]: enabled,
      }));

      const canRun = enabled && briefSettingsRef.current?.hasValidApiKey === true;
      briefModesRef.current[sessionId] = canRun ? "watching" : "paused";
      patchBrief(sessionId, {
        mode: canRun ? "watching" : "paused",
        error: null,
      });
    },
    [patchBrief],
  );

  // Helper that updates tabs state AND persists in one shot. Persisting
  // here (in the handlers) instead of in a useEffect avoids racing the
  // initial load — there's no way to accidentally write empty defaults
  // before the load completes.
  const persistTabs = (
    nextTabs: Record<string, Tab[]>,
    nextActive: Record<string, string>,
  ) => {
    tabsBySessionRef.current = nextTabs;
    activeTabBySessionRef.current = nextActive;
    setTabsBySession(nextTabs);
    setActiveTabBySession(nextActive);
    const snapshot = {
      tabsBySession: nextTabs,
      activeTabBySession: nextActive,
    };
    tabsSaveQueueRef.current = tabsSaveQueueRef.current
      .catch(() => undefined)
      .then(() => api.settings.setTabs(snapshot))
      .catch((err) => {
        console.warn("[App] failed to persist tabs:", err);
      });
  };

  // Initial load from SQLite via IPC
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [s, t, cs, savedId] = await Promise.all([
        api.sessions.list(),
        api.settings.getTabs(),
        api.pty.getConnStatusSnapshot(),
        api.settings.getLastSession(),
      ]);
      if (cancelled) return;
      setSessions(s);
      // Normalize persisted tabs — older saves may lack a `type` field.
      const normalized: Record<string, Tab[]> = {};
      for (const [sid, list] of Object.entries(t.tabsBySession)) {
        normalized[sid] = list.map((tab) => ({
          ...tab,
          type: tab.type ?? "terminal",
        }));
      }
      setTabsBySession(normalized);
      setActiveTabBySession(t.activeTabBySession);
      tabsBySessionRef.current = normalized;
      activeTabBySessionRef.current = t.activeTabBySession;
      setConnStatus(cs);
      setTabsLoaded(true);
      if (s.length > 0) {
        // Restore the last active connection, falling back to the first one.
        const targetId =
          savedId && s.some((x) => x.id === savedId) ? savedId : s[0].id;
        setView({ kind: "session", sessionId: targetId });
        setLastSessionId(targetId);
        setOpenSessionIds([targetId]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.brief.getSettings()
      .then((settings) => {
        if (!cancelled) setBriefSettings(settings);
      })
      .catch((err) => {
        console.warn("[App] failed to load brief settings:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe to connection status push events from main.
  useEffect(() => {
    const dispose = api.pty.onConnStatus((evt) => {
      setConnStatus((prev) => {
        const next = { ...prev };
        if (evt.liveCount > 0) {
          next[evt.sessionId] = evt.liveCount;
        } else {
          delete next[evt.sessionId];
        }
        return next;
      });
    });
    return dispose;
  }, []);

  // ── Keyboard shortcuts (Cmd/Ctrl+T, W, K, 1-9) ──────────────────
  // Main process intercepts via before-input-event and pushes action
  // strings over IPC. We relay them as DOM CustomEvents so the handler
  // below always sees fresh React state (it re-attaches every render).
  useEffect(() => {
    return api.shortcuts.onAction((action) => {
      document.dispatchEvent(
        new CustomEvent("tessera:shortcut", { detail: action }),
      );
    });
  }, []);

  // Handle shortcut actions with current state.
  useEffect(() => {
    const handler = (e: Event) => {
      const action = (e as CustomEvent<string>).detail;
      if (action === "newTab") {
        if (!activeSessionId) return;
        const list = tabsBySession[activeSessionId] ?? [];
        const used = new Set(
          list.map((t) => parseInt(t.name, 10)).filter((n) => !isNaN(n)),
        );
        let num = 1;
        while (used.has(num)) num++;
        const id = `t-${activeSessionId}-${num}-${Date.now()}`;
        const nextList = [...list, { id, name: String(num), type: "terminal" as const }];
        persistTabs(
          { ...tabsBySession, [activeSessionId]: nextList },
          { ...activeTabBySession, [activeSessionId]: id },
        );
      } else if (action === "closeTab") {
        if (!activeSessionId || !currentActiveTabId) return;
        // Don't close tab 1
        const list = tabsBySession[activeSessionId] ?? [];
        const idx = list.findIndex((t) => t.id === currentActiveTabId);
        if (idx <= 0) return; // index 0 = tab 1, unclosable
        const liveCount = connStatus[activeSessionId] ?? 0;
        if (liveCount > 0) {
          if (!window.confirm("This will end the connection. Close tab?")) return;
        }
        const next = list.filter((t) => t.id !== currentActiveTabId);
        persistTabs(
          { ...tabsBySession, [activeSessionId]: next },
          { ...activeTabBySession, [activeSessionId]: next[next.length - 1].id },
        );
      } else if (action === "themes") {
        setView((v) =>
          v.kind === "themes"
            ? { kind: "session", sessionId: lastSessionId }
            : { kind: "themes" },
        );
      } else if (action.startsWith("switchTab:")) {
        const n = parseInt(action.split(":")[1], 10);
        if (!activeSessionId) return;
        const list = tabsBySession[activeSessionId] ?? [];
        const target = n <= list.length ? list[n - 1] : null;
        if (target) {
          persistTabs(tabsBySession, {
            ...activeTabBySession,
            [activeSessionId]: target.id,
          });
          if (view.kind !== "session") {
            setView({ kind: "session", sessionId: lastSessionId });
          }
        }
      }
    };
    document.addEventListener("tessera:shortcut", handler);
    return () => document.removeEventListener("tessera:shortcut", handler);
  });

  const sidebarData = useMemo(
    () => buildSidebar(sessions),
    [sessions],
  );

  // Pin/unpin via repo, then refetch to pick up the new pinnedAt value.
  const handleTogglePin = async (id: string) => {
    const s = sessions.find((x) => x.id === id);
    if (!s) return;
    if (s.pinnedAt !== null) {
      await api.sessions.unpin({ id });
    } else {
      await api.sessions.pin({ id });
    }
    const next = await api.sessions.list();
    setSessions(next);
  };

  const handleMoveSession = async (id: string, direction: "up" | "down") => {
    await api.sessions.reorder({ id, direction });
    const next = await api.sessions.list();
    setSessions(next);
  };


  // The "active" session id we use for sidebar highlight + tab settings icon.
  // In create mode nothing is highlighted; in edit mode we keep the same row
  // the user is editing highlighted.
  const activeSessionId =
    view.kind === "session"
      ? view.sessionId
      : view.kind === "edit"
        ? view.sessionId
        : null;

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  useEffect(() => {
    if (!activeSessionId) return;
    const session = sessions.find((s) => s.id === activeSessionId);
    if (!session || (session.kind !== "local" && session.kind !== "ssh")) return;
    refreshBriefConfigForSession(activeSessionId).catch((err) => {
      console.warn("[App] failed to load brief config:", err);
    });
  }, [activeSessionId, sessions, refreshBriefConfigForSession]);

  useEffect(() => {
    const validKey = briefSettings?.hasValidApiKey === true;
    for (const [sessionId, enabled] of Object.entries(briefEnabledBySession)) {
      const canRun = validKey && enabled;
      briefModesRef.current[sessionId] = canRun ? "watching" : "paused";
      patchBrief(sessionId, {
        mode: canRun ? "watching" : "paused",
        pendingCount: briefBuffersRef.current[sessionId]?.length ?? 0,
        error: null,
      });
    }
  }, [briefSettings?.hasValidApiKey, briefEnabledBySession, patchBrief]);

  // Lazily seed a default tab the first time a session is viewed. We
  // wait until the persisted tabs state has loaded so we don't clobber
  // it with a fresh default.
  useEffect(() => {
    if (!tabsLoaded) return;
    if (!activeSessionId) return;
    if (tabsBySession[activeSessionId]?.length) return;
    const id = `t-${activeSessionId}-1-${Date.now()}`;
    persistTabs(
      { ...tabsBySession, [activeSessionId]: [{ id, name: "1", type: "terminal" }] },
      { ...activeTabBySession, [activeSessionId]: id },
    );
    // persistTabs is stable; eslint can't see that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabsLoaded, activeSessionId, tabsBySession]);

  const currentTabs = activeSessionId
    ? (tabsBySession[activeSessionId] ?? [])
    : [];
  const currentActiveTabId = activeSessionId
    ? (activeTabBySession[activeSessionId] ?? null)
    : null;

  // Tab labels are derived at render time as `${sessionName} ${number}` so
  // they stay fresh if a session is renamed. The number is stored in the
  // tab's own `name` field at create time. We use the session name (not the
  // project name) because all tabs in a session share the same project, so
  // the project name would be redundant — the session name is what tells
  // them apart from other open sessions.
  const displayedTabs = useMemo(
    () =>
      currentTabs.map((t) => ({
        id: t.id,
        name: t.type === "webview"
          ? (t.url ? safeHostname(t.url) : `Web ${t.name}`)
          : activeSession
            ? `${activeSession.name} ${t.name}`
            : t.name,
        type: t.type,
      })),
    [currentTabs, activeSession],
  );

  // Build the discriminated mode object that SessionPanel expects.
  const panelMode: PanelMode =
    view.kind === "create"
      ? { kind: "create" }
      : view.kind === "edit"
        ? { kind: "edit", sessionId: view.sessionId }
        : view.kind === "themes"
          ? { kind: "themes" }
          : { kind: "session", session: activeSession };

  // Per-session tab metadata for the terminal/webview layer.
  const tabDataBySession = useMemo(() => {
    const out: Record<string, Array<{ id: string; type: TabType; url?: string }>> = {};
    for (const [sid, list] of Object.entries(tabsBySession)) {
      out[sid] = list.map((t) => ({
        id: t.id,
        type: t.type ?? "terminal",
        url: t.url,
      }));
    }
    return out;
  }, [tabsBySession]);

  // The set of terminal sessions that should stay mounted underneath
  // the SessionPanel. Filtered against `sessions` so that a deleted
  // session drops out (its TerminalView unmounts → PTY torn down).
  const openTerminalSessions = useMemo(() => {
    const order = new Map(openSessionIds.map((id, i) => [id, i]));
    return sessions
      .filter(
        (s) =>
          order.has(s.id) && (s.kind === "local" || s.kind === "ssh"),
      )
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }, [sessions, openSessionIds]);

  const summarizeBriefSession = useCallback(
    async (sessionId: string) => {
      if (briefInFlightRef.current[sessionId]) return;
      const events = briefBuffersRef.current[sessionId] ?? [];
      if (events.length === 0) return;

      briefInFlightRef.current[sessionId] = true;
      briefBuffersRef.current[sessionId] = [];
      const returnMode =
        briefModesRef.current[sessionId] === "watching"
          ? "watching"
          : "paused";
      briefModesRef.current[sessionId] = "summarizing";
      patchBrief(sessionId, {
        mode: "summarizing",
        pendingCount: 0,
        error: null,
      });

      const sessionName =
        sessionsRef.current.find((s) => s.id === sessionId)?.name ?? "Session";

      try {
        const { summary } = await api.brief.summarize({
          sessionId,
          sessionName,
          model: briefSettingsRef.current?.model,
          previousSummary: briefSummariesRef.current[sessionId] ?? null,
          events,
        });
        briefSummariesRef.current[sessionId] = summary;
        const remaining = briefBuffersRef.current[sessionId] ?? [];
        const nextMode = resolveBriefReturnMode(
          briefModesRef.current[sessionId],
          returnMode,
        );
        briefModesRef.current[sessionId] = nextMode;
        patchBrief(sessionId, {
          mode: nextMode,
          summary,
          pendingCount: remaining.length,
          error: null,
        });
      } catch (err) {
        briefBuffersRef.current[sessionId] = trimBriefBuffer([
          ...events,
          ...(briefBuffersRef.current[sessionId] ?? []),
        ]);
        const nextMode = resolveBriefReturnMode(
          briefModesRef.current[sessionId],
          returnMode,
        );
        briefModesRef.current[sessionId] = nextMode;
        patchBrief(sessionId, {
          mode: nextMode,
          pendingCount: briefBuffersRef.current[sessionId]?.length ?? 0,
          error: (err as Error).message,
        });
      } finally {
        delete briefInFlightRef.current[sessionId];
      }
    },
    [patchBrief],
  );

  const handleBriefEvent = useCallback(
    (event: BriefTerminalEvent) => {
      const canBrief =
        briefSettingsRef.current?.hasValidApiKey === true &&
        briefEnabledRef.current[event.sessionId] === true;
      if (!canBrief) return;

      const mode = briefModesRef.current[event.sessionId] ?? "paused";
      if (mode !== "watching" && mode !== "summarizing") {
        briefModesRef.current[event.sessionId] = "watching";
        patchBrief(event.sessionId, { mode: "watching", error: null });
      }

      const nextEvent: BriefTerminalEvent = {
        ...event,
        text: event.text.slice(0, BRIEF_MAX_EVENT_CHARS),
      };
      const next = trimBriefBuffer([
        ...(briefBuffersRef.current[event.sessionId] ?? []),
        nextEvent,
      ]);
      briefBuffersRef.current[event.sessionId] = next;

      const now = Date.now();
      const lastUpdate = briefUiUpdateRef.current[event.sessionId] ?? 0;
      if (now - lastUpdate > 750 || next.length % 10 === 0) {
        briefUiUpdateRef.current[event.sessionId] = now;
        patchBrief(event.sessionId, {
          pendingCount: next.length,
          observedSince:
            briefs[event.sessionId]?.observedSince ?? event.ts,
          error: null,
        });
      }
    },
    [briefs, patchBrief],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      for (const [sessionId, events] of Object.entries(briefBuffersRef.current)) {
        if (briefSettingsRef.current?.hasValidApiKey !== true) continue;
        if (briefEnabledRef.current[sessionId] !== true) continue;
        if (briefModesRef.current[sessionId] !== "watching") continue;
        if (briefInFlightRef.current[sessionId]) continue;
        if (
          events.length >= BRIEF_MIN_BATCH_EVENTS ||
          bufferChars(events) >= BRIEF_MIN_BATCH_CHARS
        ) {
          summarizeBriefSession(sessionId);
        }
      }
    }, BRIEF_AUTO_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [summarizeBriefSession]);

  const handleClearBrief = (sessionId: string) => {
    briefBuffersRef.current[sessionId] = [];
    briefSummariesRef.current[sessionId] = null;
    briefModesRef.current[sessionId] = "paused";
    patchBrief(sessionId, emptyBriefState());
  };

  const handleNewFromPlus = (type: "connection" | "webview") => {
    if (!activeSessionId) return;
    const list = tabsBySession[activeSessionId] ?? [];
    const used = new Set(
      list.map((t) => parseInt(t.name, 10)).filter((n) => !isNaN(n)),
    );
    let num = 1;
    while (used.has(num)) num++;
    const tabType = type === "webview" ? "webview" : "terminal";
    const id = `t-${activeSessionId}-${num}-${Date.now()}`;
    const newTab: Tab = { id, name: String(num), type: tabType };
    const nextList = [...list, newTab];
    persistTabs(
      { ...tabsBySession, [activeSessionId]: nextList },
      { ...activeTabBySession, [activeSessionId]: id },
    );
  };

  const handleCloseTab = (id: string) => {
    if (!activeSessionId) return;
    const list = tabsBySession[activeSessionId] ?? [];
    // Warn if this session has a live connection — closing the tab kills
    // the PTY, which may surprise the user mid-work.
    const closingTab = list.find((t) => t.id === id);
    const liveCount = connStatus[activeSessionId] ?? 0;
    if (closingTab?.type === "terminal" && liveCount > 0) {
      if (!window.confirm("This will end the connection. Close tab?")) return;
    }
    const next = list.filter((t) => t.id !== id);
    // Tab 1 is unclosable (TabBar hides the X), so next always has ≥1.
    const nextActive =
      currentActiveTabId === id
        ? { ...activeTabBySession, [activeSessionId]: next[next.length - 1].id }
        : activeTabBySession;
    persistTabs({ ...tabsBySession, [activeSessionId]: next }, nextActive);
  };

  // Clicking a tab in the tab bar both selects that tab AND bounces us
  // back to the session view if we were on themes / the create / edit
  // form. The bounce makes the tab feel like a real "take me back to
  // my terminal" affordance.
  const handleSelectTab = (id: string) => {
    if (activeSessionId) {
      persistTabs(tabsBySession, {
        ...activeTabBySession,
        [activeSessionId]: id,
      });
    }
    if (view.kind !== "session") {
      setView({ kind: "session", sessionId: lastSessionId });
    }
  };

  const handleSelectSession = (id: string) => {
    setView({ kind: "session", sessionId: id });
    setLastSessionId(id);
    api.settings.setLastSession(id);
    markOpen(id);
  };

  const handleOpenSessionSettings = (id: string) => {
    setView({ kind: "edit", sessionId: id });
  };

  const handleNewConnection = () => setView({ kind: "create" });

  const handleDeleteSession = async (sessionId: string) => {
    // Refetch sessions to drop the deleted one.
    const next = await api.sessions.list();
    setSessions(next);
    // Remove its tabs from persisted state.
    const nextTabs = { ...tabsBySession };
    const nextActive = { ...activeTabBySession };
    delete nextTabs[sessionId];
    delete nextActive[sessionId];
    persistTabs(nextTabs, nextActive);
    // Remove from open set so its TerminalView unmounts.
    setOpenSessionIds((prev) => prev.filter((id) => id !== sessionId));
    // Navigate to the next available session, or empty.
    const fallback = next.length > 0 ? next[0].id : null;
    setView({ kind: "session", sessionId: fallback });
    setLastSessionId(fallback);
    if (fallback) {
      api.settings.setLastSession(fallback);
      markOpen(fallback);
    }
  };

  const handleTabUrlChange = (sessionId: string, tabId: string, url: string) => {
    const currentTabsBySession = tabsBySessionRef.current;
    const currentActiveTabBySession = activeTabBySessionRef.current;
    const list = currentTabsBySession[sessionId] ?? [];
    const nextList = list.map((t) =>
      t.id === tabId ? { ...t, url } : t,
    );
    persistTabs(
      { ...currentTabsBySession, [sessionId]: nextList },
      currentActiveTabBySession,
    );
  };

  const handleSaved = (saved: Session) => {
    // Refetch the full list so positions/ordering stay correct after either
    // a create or an update (project_id may have changed).
    api.sessions.list().then((s) => {
      setSessions(s);
      setView({ kind: "session", sessionId: saved.id });
      setLastSessionId(saved.id);
      api.settings.setLastSession(saved.id);
      markOpen(saved.id);
      refreshBriefConfigForSession(saved.id).catch((err) => {
        console.warn("[App] failed to refresh brief config:", err);
      });
    });
  };

  const handleCancel = () => {
    // Bounce back to whatever was selected before, or empty.
    setView({ kind: "session", sessionId: lastSessionId });
  };

  // The settings icon doubles as a toggle: when the form is open it closes
  // it (returning to whatever session was previously visible); when a session
  // is being viewed it opens edit mode for that session.
  const settingsActive = view.kind === "create" || view.kind === "edit";
  const handleToggleSettings = () => {
    if (settingsActive) {
      setView({ kind: "session", sessionId: lastSessionId });
    } else if (view.kind === "session" && view.sessionId) {
      setView({ kind: "edit", sessionId: view.sessionId });
    }
  };
  // Hide the icon entirely when there's nothing meaningful to do — no form
  // open and no session selected.
  const settingsHandler =
    settingsActive || (view.kind === "session" && !!view.sessionId)
      ? handleToggleSettings
      : null;
  const showBriefPanel =
    !!activeSessionId &&
    !!activeSession &&
    (activeSession.kind === "local" || activeSession.kind === "ssh") &&
    briefSettings?.hasValidApiKey === true &&
    briefEnabledBySession[activeSessionId] === true;

  return (
    <div className="flex h-screen w-screen flex-col bg-bg text-fg">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          sessions={sidebarData}
          activeId={activeSessionId}
          connStatus={connStatus}
          onSelect={handleSelectSession}
          onOpenSettings={handleOpenSessionSettings}
          onTogglePin={handleTogglePin}
          onMove={handleMoveSession}
          onNew={handleNewConnection}
        />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <TabBar
            tabs={displayedTabs}
            // When the settings form is open the gear icon is the
            // visually-active item — clear the tab highlight so we don't
            // show two selected things at once.
            activeId={settingsActive ? null : currentActiveTabId}
            onSelect={handleSelectTab}
            onClose={handleCloseTab}
            onNew={handleNewFromPlus}
            onSettings={settingsHandler}
            settingsActive={settingsActive}
          />
          <div className="flex-1 overflow-hidden p-2">
            <div className="h-full w-full rounded border border-divider bg-bg p-2">
              <SessionPanel
                mode={panelMode}
                openTerminalSessions={openTerminalSessions}
                activeSessionId={activeSessionId}
                tabDataBySession={tabDataBySession}
                activeTabBySession={activeTabBySession}
                onSaved={handleSaved}
                onCancel={handleCancel}
                onDeleted={handleDeleteSession}
                onTabUrlChange={handleTabUrlChange}
                onBriefEvent={handleBriefEvent}
                onBriefSettingsChanged={handleBriefSettingsChanged}
                onTransfer={handleTerminalTransfer}
              />
            </div>
          </div>
        </main>
        {showBriefPanel && (
          <BriefPanel
            session={activeSession}
            state={activeSessionId ? briefs[activeSessionId] : undefined}
            onClear={handleClearBrief}
            onSummarizeNow={summarizeBriefSession}
          />
        )}
      </div>
      <StatusBar sessions={sessions.length} transfer={transferStatus} />
    </div>
  );
}

export default App;
