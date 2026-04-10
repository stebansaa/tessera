import { Pin, PinOff } from "lucide-react";
import type { Session, SessionKind } from "../shared/ipc";

/**
 * Sidebar takes already-grouped data: PINNED at the top, RECENT below it,
 * then the regular projects list. App.tsx is responsible for joining the
 * flat IPC results into this layered shape.
 *
 * Sessions can appear in multiple sections — a pinned session also lives
 * inside its project — which intentionally matches how Slack/Discord show
 * starred channels.
 */
interface SidebarProject {
  id: string;
  name: string;
  sessions: Session[];
}

interface SidebarProps {
  pinned: Session[];
  recent: Session[];
  projects: SidebarProject[];
  activeId: string | null;
  /** Per-session live connection count from main. Key present = connected. */
  connStatus: Record<string, number>;
  onSelect: (id: string) => void;
  onTogglePin: (id: string) => void;
  onNew: () => void;
}

export function Sidebar({
  pinned,
  recent,
  projects,
  activeId,
  connStatus,
  onSelect,
  onTogglePin,
  onNew,
}: SidebarProps) {
  return (
    <aside className="flex h-full w-[260px] flex-col border-r border-divider bg-bg select-none">
      {/* New Session button — top, ChatGPT style */}
      <div className="px-3 pb-2 pt-3">
        <button
          onClick={onNew}
          className="flex w-full items-center gap-2 rounded-md border border-divider bg-bg-header px-3 py-2 text-sm text-fg-bright transition hover:bg-bg-active"
        >
          <span className="text-base leading-none">+</span>
          <span>New session</span>
        </button>
      </div>

      <div className="scroll-themed flex-1 overflow-y-auto pb-3">
        {pinned.length > 0 && (
          <Section title="Pinned">
            {pinned.map((s) => (
              <SessionRow
                key={`pinned-${s.id}`}
                session={s}
                active={s.id === activeId}
                connected={!!connStatus[s.id]}
                onClick={() => onSelect(s.id)}
                onTogglePin={() => onTogglePin(s.id)}
              />
            ))}
          </Section>
        )}

        {recent.length > 0 && (
          <Section title="Recent">
            {recent.map((s) => (
              <SessionRow
                key={`recent-${s.id}`}
                session={s}
                active={s.id === activeId}
                connected={!!connStatus[s.id]}
                onClick={() => onSelect(s.id)}
                onTogglePin={() => onTogglePin(s.id)}
              />
            ))}
          </Section>
        )}

        {projects.map((project) => (
          <Section key={project.id} title={project.name}>
            {project.sessions.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                active={s.id === activeId}
                connected={!!connStatus[s.id]}
                onClick={() => onSelect(s.id)}
                onTogglePin={() => onTogglePin(s.id)}
              />
            ))}
          </Section>
        ))}
      </div>

    </aside>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3 first:mt-1">
      <div className="px-4 pb-1 pt-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-dim">
          {title}
        </span>
      </div>
      <ul>{children}</ul>
    </div>
  );
}

function SessionRow({
  session,
  active,
  connected,
  onClick,
  onTogglePin,
}: {
  session: Session;
  active: boolean;
  connected: boolean;
  onClick: () => void;
  onTogglePin: () => void;
}) {
  const isPinned = session.pinnedAt !== null;
  return (
    <li>
      <div
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
        <button
          type="button"
          onClick={onClick}
          className="flex flex-1 items-center gap-2 truncate text-left"
        >
          <Dot kind={session.kind} connected={connected} />
          <span className="flex-1 truncate">{session.name}</span>
        </button>
        {/* Pin button — visible on hover, or always when already pinned. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
          title={isPinned ? "Unpin" : "Pin to top"}
          className={[
            "rounded p-0.5 transition",
            isPinned
              ? "text-fg-dim opacity-100 hover:text-fg-bright"
              : "text-fg-muted opacity-0 hover:text-fg-bright group-hover:opacity-100",
          ].join(" ")}
        >
          {isPinned ? <PinOff size={12} /> : <Pin size={12} />}
        </button>
        <span className="text-[10px] uppercase tracking-wider text-fg-muted">
          {session.kind}
        </span>
      </div>
    </li>
  );
}

function Dot({ kind, connected }: { kind: SessionKind; connected: boolean }) {
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
