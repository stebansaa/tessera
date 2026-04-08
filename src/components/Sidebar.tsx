import type { Session, SessionKind, Project } from "../types";

interface SidebarProps {
  projects: Project[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export function Sidebar({ projects, activeId, onSelect, onNew }: SidebarProps) {
  const total = projects.reduce((n, p) => n + p.sessions.length, 0);

  return (
    <aside className="flex h-full w-[240px] flex-col border-r border-divider bg-bg select-none">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-divider bg-bg-header px-4 py-3.5">
        <span className="text-accent">◆</span>
        <span className="text-sm font-medium tracking-wide text-fg-bright">
          Workspace
        </span>
      </div>

      {/* Projects + sessions */}
      <div className="flex-1 overflow-y-auto py-2">
        {projects.map((project, idx) => (
          <div key={project.id} className={idx === 0 ? "" : "mt-3"}>
            <div className="flex items-center justify-between px-4 pb-1 pt-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-dim">
                {project.name}
              </span>
              <button className="text-fg-muted transition hover:text-fg-dim">
                <span className="text-sm leading-none">+</span>
              </button>
            </div>
            <ul>
              {project.sessions.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  active={s.id === activeId}
                  onClick={() => onSelect(s.id)}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="border-t border-divider bg-bg-footer">
        <button
          onClick={onNew}
          className="flex w-full items-center gap-2 px-4 py-3 text-sm text-fg-button transition hover:bg-white/[0.03]"
        >
          <span className="text-base leading-none">+</span>
          <span>New Session</span>
        </button>
        <div className="flex items-center gap-2 px-4 pb-3 pt-1 text-xs text-fg-muted">
          <span className="text-dot-on">◐</span>
          <span>{total} active</span>
        </div>
      </div>
    </aside>
  );
}

function SessionRow({
  session,
  active,
  onClick,
}: {
  session: Session;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={[
          "group relative flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm transition",
          active
            ? "bg-bg-active text-fg-bright"
            : "text-fg hover:bg-white/[0.025]",
        ].join(" ")}
      >
        {active && (
          <span className="absolute inset-y-0 left-0 w-[3px] bg-accent" />
        )}
        <Dot kind={session.kind} connected={session.connected} />
        <span className="flex-1 truncate">{session.name}</span>
        <span className="text-[10px] uppercase tracking-wider text-fg-muted">
          {session.kind}
        </span>
      </button>
    </li>
  );
}

function Dot({
  kind,
  connected,
}: {
  kind: SessionKind;
  connected?: boolean;
}) {
  let color = "text-dot-off";
  let glyph = "●";
  if (kind === "ssh" || kind === "local") {
    color = connected ? "text-dot-on" : "text-dot-off";
    glyph = "●";
  } else if (kind === "llm") {
    color = "text-dot-llm";
    glyph = "✦";
  } else if (kind === "web") {
    color = "text-dot-web";
    glyph = "◉";
  }
  return <span className={`text-[10px] ${color}`}>{glyph}</span>;
}
