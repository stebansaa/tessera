import { ChevronDown, ChevronUp, Pin, PinOff } from "lucide-react";
import type { Session, SessionKind } from "../shared/ipc";

interface SidebarProps {
  sessions: Session[];
  activeId: string | null;
  connStatus: Record<string, number>;
  onSelect: (id: string) => void;
  onTogglePin: (id: string) => void;
  onMove: (id: string, direction: "up" | "down") => void;
  onNew: () => void;
}

export function Sidebar({
  sessions,
  activeId,
  connStatus,
  onSelect,
  onTogglePin,
  onMove,
  onNew,
}: SidebarProps) {
  return (
    <aside className="flex h-full w-[260px] flex-col border-r border-divider bg-bg select-none">
      <div className="px-3 pb-2 pt-3">
        <button
          onClick={onNew}
          className="flex w-full items-center gap-2 rounded-md border border-divider bg-bg-header px-3 py-2 text-sm text-fg-bright transition hover:bg-bg-active"
        >
          <span className="text-base leading-none">+</span>
          <span>New connection</span>
        </button>
      </div>

      <div className="scroll-themed flex-1 overflow-y-auto px-1 pb-3 pt-1">
        <ul>
          {sessions.map((s, idx) => (
            <SessionRow
              key={s.id}
              session={s}
              active={s.id === activeId}
              connected={!!connStatus[s.id]}
              isFirst={idx === 0}
              isLast={idx === sessions.length - 1}
              onClick={() => onSelect(s.id)}
              onTogglePin={() => onTogglePin(s.id)}
              onMoveUp={() => onMove(s.id, "up")}
              onMoveDown={() => onMove(s.id, "down")}
            />
          ))}
        </ul>
      </div>
    </aside>
  );
}

function SessionRow({
  session,
  active,
  connected,
  isFirst,
  isLast,
  onClick,
  onTogglePin,
  onMoveUp,
  onMoveDown,
}: {
  session: Session;
  active: boolean;
  connected: boolean;
  isFirst: boolean;
  isLast: boolean;
  onClick: () => void;
  onTogglePin: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const isPinned = session.pinnedAt !== null;
  return (
    <li>
      <div
        className={[
          "group relative flex w-full items-center gap-1.5 rounded-md px-3 py-1.5 text-left text-sm transition",
          active
            ? "bg-bg-active text-fg-bright"
            : "text-fg hover:bg-white/[0.025]",
        ].join(" ")}
      >
        {active && (
          <span className="absolute inset-y-0 left-0 w-[3px] rounded-l-md bg-accent" />
        )}
        <button
          type="button"
          onClick={onClick}
          className="flex flex-1 items-center gap-2 truncate text-left"
        >
          <Dot kind={session.kind} connected={connected} />
          <span className="flex-1 truncate">{session.name}</span>
        </button>

        {/* Hover controls: move up/down + pin */}
        <div className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMoveUp();
            }}
            title="Move up"
            disabled={isFirst}
            className="rounded p-0.5 text-fg-muted transition hover:text-fg-bright disabled:opacity-20"
          >
            <ChevronUp size={12} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMoveDown();
            }}
            title="Move down"
            disabled={isLast}
            className="rounded p-0.5 text-fg-muted transition hover:text-fg-bright disabled:opacity-20"
          >
            <ChevronDown size={12} />
          </button>
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
                ? "text-fg-dim hover:text-fg-bright"
                : "text-fg-muted hover:text-fg-bright",
            ].join(" ")}
          >
            {isPinned ? <PinOff size={12} /> : <Pin size={12} />}
          </button>
        </div>

        {/* Always-visible pin indicator when pinned (outside the hover group) */}
        {isPinned && (
          <span className="text-fg-dim group-hover:hidden">
            <Pin size={10} />
          </span>
        )}

        <span className="text-[10px] uppercase tracking-wider text-fg-muted">
          {session.kind}
        </span>
      </div>
    </li>
  );
}

function Dot({ kind, connected }: { kind: SessionKind; connected: boolean }) {
  let color = "text-dot-off";
  let glyph = "\u25CF";
  if (kind === "ssh" || kind === "local") {
    color = connected ? "text-dot-on" : "text-dot-off";
    glyph = "\u25CF";
  } else if (kind === "llm") {
    color = "text-dot-llm";
    glyph = "\u2726";
  } else if (kind === "web") {
    color = "text-dot-web";
    glyph = "\u25C9";
  }
  return <span className={`text-[10px] ${color}`}>{glyph}</span>;
}
