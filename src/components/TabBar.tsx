interface Tab {
  id: string;
  name: string;
}

interface TabBarProps {
  tabs: Tab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}

export function TabBar({ tabs, activeId, onSelect, onClose, onNew }: TabBarProps) {
  return (
    <div className="flex h-9 items-end border-b border-divider bg-bg-header pl-2 pr-2">
      <div className="flex flex-1 items-end gap-px overflow-x-auto">
        {tabs.map((t) => {
          const active = t.id === activeId;
          return (
            <div
              key={t.id}
              onClick={() => onSelect(t.id)}
              className={[
                "group flex h-8 cursor-pointer items-center gap-2 rounded-t border border-b-0 px-3 text-xs transition",
                active
                  ? "border-divider bg-bg text-fg-bright"
                  : "border-transparent text-fg-dim hover:text-fg",
              ].join(" ")}
            >
              <span className="truncate">{t.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(t.id);
                }}
                className="text-fg-muted opacity-0 transition group-hover:opacity-100 hover:text-fg-bright"
              >
                ×
              </button>
            </div>
          );
        })}
        <button
          onClick={onNew}
          className="ml-1 flex h-7 w-7 items-center justify-center rounded text-fg-muted transition hover:bg-white/[0.04] hover:text-fg"
        >
          +
        </button>
      </div>
    </div>
  );
}
