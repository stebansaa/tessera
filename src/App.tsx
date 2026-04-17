import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { TabBar } from "./components/TabBar";
import { StatusBar } from "./components/StatusBar";
import { SessionPanel, type PanelMode } from "./components/SessionPanel";
import { api } from "./lib/api";
import type { Session, TabType } from "./shared/ipc";

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

  // Helper that updates tabs state AND persists in one shot. Persisting
  // here (in the handlers) instead of in a useEffect avoids racing the
  // initial load — there's no way to accidentally write empty defaults
  // before the load completes.
  const persistTabs = (
    nextTabs: Record<string, Tab[]>,
    nextActive: Record<string, string>,
  ) => {
    setTabsBySession(nextTabs);
    setActiveTabBySession(nextActive);
    api.settings.setTabs({
      tabsBySession: nextTabs,
      activeTabBySession: nextActive,
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
    // Warn if this session has a live connection — closing the tab kills
    // the PTY, which may surprise the user mid-work.
    const liveCount = connStatus[activeSessionId] ?? 0;
    if (liveCount > 0) {
      if (!window.confirm("This will end the connection. Close tab?")) return;
    }
    const list = tabsBySession[activeSessionId] ?? [];
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

  const handleTabUrlChange = (tabId: string, url: string) => {
    if (!activeSessionId) return;
    const list = tabsBySession[activeSessionId] ?? [];
    const nextList = list.map((t) =>
      t.id === tabId ? { ...t, url } : t,
    );
    persistTabs(
      { ...tabsBySession, [activeSessionId]: nextList },
      activeTabBySession,
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

  return (
    <div className="flex h-screen w-screen flex-col bg-bg text-fg">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          sessions={sidebarData}
          activeId={activeSessionId}
          connStatus={connStatus}
          onSelect={handleSelectSession}
          onTogglePin={handleTogglePin}
          onMove={handleMoveSession}
          onNew={handleNewConnection}
        />
        <main className="flex flex-1 flex-col overflow-hidden">
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
              />
            </div>
          </div>
        </main>
      </div>
      <StatusBar sessions={sessions.length} />
    </div>
  );
}

export default App;
