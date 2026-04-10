import { useEffect, useState } from "react";
import { TerminalTabs } from "./TerminalTabs";
import { SessionForm } from "./SessionForm";
import { ThemePanel } from "./ThemePanel";
import { api } from "../lib/api";
import type { Project, Session } from "../shared/ipc";

/**
 * The main content area can be in one of four modes:
 *
 *   - 'session': bring the active session's terminal to the front. Every
 *                terminal session the user has ever opened in this run
 *                stays mounted underneath, so switching back to it picks
 *                up the live PTY/SSH connection instead of reconnecting.
 *   - 'create':  render an inline form for creating a new session. Takes
 *                over the whole panel as an overlay above the terminal
 *                layer — no modal.
 *   - 'edit':    same form pre-filled with the active session's details.
 *   - 'themes':  render the themes settings page (accent/font/size).
 *
 * The terminal layer is *always* rendered. In non-session modes (create/
 * edit/themes) it's hidden behind the overlay but the PTYs keep running,
 * which is the whole point — opening the settings form must not drop a
 * live SSH connection.
 */
export type PanelMode =
  | { kind: "session"; session: Session | null }
  | { kind: "create" }
  | { kind: "edit"; sessionId: string }
  | { kind: "themes" };

interface Props {
  mode: PanelMode;
  /** All terminal sessions the user has visited in this run. They stay
   *  mounted across session switches so connections persist. */
  openTerminalSessions: Session[];
  /** id of the currently selected session, or null. Drives which row in
   *  the terminal layer gets `visibility: visible`. */
  activeSessionId: string | null;
  /** Per-session tab id list. Indexed by session id. */
  tabIdsBySession: Record<string, string[]>;
  /** Per-session active tab id. */
  activeTabBySession: Record<string, string>;
  projects: Project[];
  defaultProjectId: string | null;
  onSaved: (session: Session) => void;
  onCancel: () => void;
}

export function SessionPanel({
  mode,
  openTerminalSessions,
  activeSessionId,
  tabIdsBySession,
  activeTabBySession,
  projects,
  defaultProjectId,
  onSaved,
  onCancel,
}: Props) {
  // The terminal layer is in the back; the overlay (form / themes / empty
  // placeholder) sits on top when needed. We toggle visibility, never
  // unmount, so PTYs survive overlay open/close and session switches.
  const inSessionMode = mode.kind === "session";
  const visibleSessionId = inSessionMode ? activeSessionId : null;

  // Decide what (if anything) sits on top of the terminal layer.
  let overlay: React.ReactNode = null;
  if (mode.kind === "create") {
    overlay = (
      <SessionForm
        mode={{ kind: "create" }}
        projects={projects}
        defaultProjectId={defaultProjectId}
        onSaved={onSaved}
        onCancel={onCancel}
      />
    );
  } else if (mode.kind === "edit") {
    overlay = (
      <SessionForm
        mode={{ kind: "edit", sessionId: mode.sessionId }}
        projects={projects}
        defaultProjectId={defaultProjectId}
        onSaved={onSaved}
        onCancel={onCancel}
      />
    );
  } else if (mode.kind === "themes") {
    overlay = <ThemePanel />;
  } else if (mode.kind === "session") {
    const s = mode.session;
    if (!s) {
      overlay = <Empty label="No session selected" />;
    } else if (s.kind === "llm") {
      overlay = <Empty label="LLM chat — Phase 4" />;
    } else if (s.kind === "web") {
      overlay = <Empty label="Webview — Phase 5" />;
    }
    // Terminal-kind sessions render through the terminal layer below; no
    // overlay needed.
  }

  return (
    <div className="relative h-full w-full">
      {/* Persistent terminal layer */}
      <div className="absolute inset-0">
        {openTerminalSessions.map((s) => {
          const visible = s.id === visibleSessionId;
          return (
            <div
              key={s.id}
              className="absolute inset-0"
              style={{
                visibility: visible ? "visible" : "hidden",
                zIndex: visible ? 1 : 0,
              }}
            >
              <TerminalSessionView
                session={s}
                tabIds={tabIdsBySession[s.id] ?? []}
                activeTabId={activeTabBySession[s.id] ?? null}
              />
            </div>
          );
        })}
      </div>

      {overlay && (
        <div className="absolute inset-0 z-10 bg-bg">{overlay}</div>
      )}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center text-sm text-fg-muted">
      {label}
    </div>
  );
}

/**
 * Wrapper that fetches the SSH host/user once per session so the
 * connecting overlay can show "user@host" before the first byte
 * arrives. Local sessions skip the fetch and pass `undefined`, which
 * makes TerminalView suppress the overlay entirely.
 */
function TerminalSessionView({
  session,
  tabIds,
  activeTabId,
}: {
  session: Session;
  tabIds: string[];
  activeTabId: string | null;
}) {
  const [connectingLabel, setConnectingLabel] = useState<string | undefined>(
    undefined,
  );

  useEffect(() => {
    if (session.kind !== "ssh") {
      setConnectingLabel(undefined);
      return;
    }
    let cancelled = false;
    api.sessions.getDetails({ id: session.id }).then((d) => {
      if (cancelled) return;
      const t = d?.terminal;
      if (t?.host && t?.username) {
        setConnectingLabel(`${t.username}@${t.host}`);
      } else {
        setConnectingLabel("remote host");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [session.id, session.kind]);

  return (
    <TerminalTabs
      sessionId={session.id}
      tabIds={tabIds}
      activeTabId={activeTabId}
      connectingLabel={connectingLabel}
    />
  );
}
