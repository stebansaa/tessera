import { Settings } from "lucide-react";

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
  /**
   * Called when the settings icon at the far right is clicked. Pass null
   * to hide the icon entirely — typically when there's nothing to settings
   * and the form isn't open.
   */
  onSettings?: (() => void) | null;
  /**
   * When true, the settings icon shows its selected/active state — used to
   * signal that the form is currently open (create or edit mode). Same idea
   * as a tab being marked as the active tab.
   */
  settingsActive?: boolean;
}

export function TabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNew,
  onSettings,
  settingsActive = false,
}: TabBarProps) {
  return (
    <div className="flex h-11 items-end border-b border-divider bg-bg-header pl-2 pr-2">
      {/*
        Tabs flex to share the available space, browser-style.
        - flex-1 + min-w-0 lets them shrink below their content.
        - basis-0 means they all start equal, no preference for first.
        - min-w sets the floor before horizontal scroll kicks in.
        - max-w stops them from getting absurdly wide when there's only
          one or two tabs.
      */}
      <div className="flex min-w-0 flex-1 items-end gap-px overflow-x-auto">
        {tabs.map((t, i) => {
          const active = t.id === activeId;
          // Tab 1 (index 0) is the session's home tab — always present,
          // never closable. Only tabs 2+ show the close button.
          const closable = i > 0;
          return (
            <div
              key={t.id}
              onClick={() => onSelect(t.id)}
              style={{ flex: "1 1 0", minWidth: 80, maxWidth: 220 }}
              className={[
                "group flex h-10 cursor-pointer items-center gap-2 rounded-t border border-b-0 px-3 text-sm transition",
                active
                  ? "border-divider bg-bg text-fg-bright"
                  : "border-transparent text-fg-dim hover:text-fg",
              ].join(" ")}
            >
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              {closable && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(t.id);
                  }}
                  className={[
                    "text-base leading-none transition hover:text-fg-bright",
                    active
                      ? "text-fg-muted opacity-100"
                      : "text-fg-muted opacity-0 group-hover:opacity-100",
                  ].join(" ")}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button
        onClick={onNew}
        title="New tab"
        className="ml-2 mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded text-2xl leading-none text-fg transition hover:bg-white/[0.06] hover:text-fg-bright"
      >
        +
      </button>

      {onSettings && (
        <button
          onClick={onSettings}
          title="Session settings"
          className={[
            "mb-1 ml-2 flex h-9 w-9 items-center justify-center rounded transition",
            settingsActive
              ? "bg-white/[0.06] text-fg-bright"
              : "text-fg-muted hover:bg-white/[0.04] hover:text-fg",
          ].join(" ")}
        >
          <Settings size={16} />
        </button>
      )}
    </div>
  );
}
