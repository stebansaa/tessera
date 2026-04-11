import { useEffect, useRef, useState } from "react";
import { Globe, Settings, Terminal } from "lucide-react";

interface Tab {
  id: string;
  name: string;
  type?: "terminal" | "webview";
}

interface TabBarProps {
  tabs: Tab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: (type: "connection" | "webview") => void;
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);
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
              {t.type === "webview" ? (
                <Globe size={12} className="shrink-0 text-fg-muted" />
              ) : (
                <Terminal size={12} className="shrink-0 text-fg-muted" />
              )}
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
      <div className="relative ml-2 mb-1" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          title="New tab"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-2xl leading-none text-fg transition hover:bg-white/[0.06] hover:text-fg-bright"
        >
          +
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-lg border border-divider bg-bg-header py-1 shadow-xl">
            <button
              onClick={() => {
                onNew("connection");
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-fg hover:bg-bg-active transition"
            >
              <Terminal size={14} className="text-fg-muted" />
              Connection
            </button>
            <button
              onClick={() => {
                onNew("webview");
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-fg hover:bg-bg-active transition"
            >
              <Globe size={14} className="text-fg-muted" />
              Web page
            </button>
          </div>
        )}
      </div>

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
