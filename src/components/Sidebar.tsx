import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Pin, PinOff, Settings, Terminal, X } from "lucide-react";
import type { Session, SessionKind } from "../shared/ipc";

interface SidebarProps {
  sessions: Session[];
  activeId: string | null;
  connStatus: Record<string, number>;
  onSelect: (id: string) => void;
  onOpenSettings: (id: string) => void;
  onTogglePin: (id: string) => void;
  onMove: (id: string, direction: "up" | "down") => void;
  onNew: () => void;
}

export function Sidebar({
  sessions,
  activeId,
  connStatus,
  onSelect,
  onOpenSettings,
  onTogglePin,
  onMove,
  onNew,
}: SidebarProps) {
  const [actionSession, setActionSession] = useState<Session | null>(null);

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
              onOpenActions={() => setActionSession(s)}
              onTogglePin={() => onTogglePin(s.id)}
              onMoveUp={() => onMove(s.id, "up")}
              onMoveDown={() => onMove(s.id, "down")}
            />
          ))}
        </ul>
      </div>

      {actionSession && (
        <ConnectionActionsModal
          session={actionSession}
          connected={!!connStatus[actionSession.id]}
          onClose={() => setActionSession(null)}
          onOpen={() => {
            onSelect(actionSession.id);
            setActionSession(null);
          }}
          onOpenSettings={() => {
            onOpenSettings(actionSession.id);
            setActionSession(null);
          }}
        />
      )}
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
  onOpenActions,
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
  onOpenActions: () => void;
  onTogglePin: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const isPinned = session.pinnedAt !== null;
  return (
    <li>
      <div
        onClick={onClick}
        className={[
          "group relative flex w-full cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-left text-sm transition",
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
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          className="shrink-0"
          title="Open connection"
        >
          <Dot kind={session.kind} connected={connected} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenActions();
          }}
          className="min-w-0 flex-1 truncate text-left transition hover:text-fg-bright"
          title="Connection actions"
        >
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

function ConnectionActionsModal({
  session,
  connected,
  onClose,
  onOpen,
  onOpenSettings,
}: {
  session: Session;
  connected: boolean;
  onClose: () => void;
  onOpen: () => void;
  onOpenSettings: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-[360px] rounded-xl border border-divider bg-bg-header p-4 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start gap-3">
          <div className="mt-1">
            <Dot kind={session.kind} connected={connected} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-medium text-fg-bright">
              {session.name}
            </h2>
            <p className="mt-1 text-xs uppercase tracking-[0.12em] text-fg-muted">
              {session.kind} connection
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-fg-muted transition hover:bg-white/[0.06] hover:text-fg"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2">
          <button
            type="button"
            onClick={onOpen}
            className="flex w-full items-center gap-3 rounded-lg border border-divider bg-bg px-3 py-2.5 text-left text-sm text-fg transition hover:bg-bg-active hover:text-fg-bright"
          >
            <Terminal size={15} className="text-fg-muted" />
            <span>Open connection</span>
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            className="flex w-full items-center gap-3 rounded-lg border border-divider bg-bg px-3 py-2.5 text-left text-sm text-fg transition hover:bg-bg-active hover:text-fg-bright"
          >
            <Settings size={15} className="text-fg-muted" />
            <span>Connection settings</span>
          </button>
        </div>
      </div>
    </div>
  );
}
