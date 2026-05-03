import { TerminalView, type TerminalTransferEvent } from "./TerminalView";
import { WebviewTab } from "./WebviewTab";
import type { BriefTerminalEvent, TabType } from "../shared/ipc";

/**
 * Renders one view per tab (TerminalView or WebviewTab) and only shows
 * the active one.
 *
 * Inactive tabs use `visibility: hidden` (not `display: none`) so the
 * underlying div keeps its layout dimensions — that's what xterm's
 * FitAddon needs to compute the cell grid correctly. With display:none
 * the terminal would mount at 0×0 and only fix itself on the next
 * resize, which makes tab switches feel broken.
 *
 * Each view has a stable `key` so it stays mounted across tab switches
 * — terminals keep their PTY running, webviews keep their page loaded.
 */
interface TabData {
  id: string;
  type: TabType;
  url?: string;
}

interface Props {
  /** Session id — passed down so each TerminalView can tell main which
   *  session it's spawning for (local PTY vs SSH is decided in main). */
  sessionId: string;
  tabs: TabData[];
  activeTabId: string | null;
  /** Optional "user@host" label, set only for SSH sessions, used by
   *  TerminalView to render the connecting overlay before first byte. */
  connectingLabel?: string;
  optimisticEcho?: boolean;
  onTabUrlChange: (sessionId: string, tabId: string, url: string) => void;
  onBriefEvent?: (event: BriefTerminalEvent) => void;
  onTransfer?: (event: TerminalTransferEvent) => void;
}

export function TerminalTabs({
  sessionId,
  tabs,
  activeTabId,
  connectingLabel,
  optimisticEcho = false,
  onTabUrlChange,
  onBriefEvent,
  onTransfer,
}: Props) {
  return (
    <div className="relative h-full w-full">
      {tabs.map((tab) => {
        const visible = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className="absolute inset-0"
            style={{
              visibility: visible ? "visible" : "hidden",
              zIndex: visible ? 1 : 0,
            }}
          >
            {tab.type === "webview" ? (
              <WebviewTab
                tabId={tab.id}
                initialUrl={tab.url}
                onUrlChange={(url) => onTabUrlChange(sessionId, tab.id, url)}
              />
            ) : (
              <TerminalView
                sessionId={sessionId}
                tabId={tab.id}
                connectingLabel={connectingLabel}
                optimisticEcho={optimisticEcho}
                onBriefEvent={onBriefEvent}
                onTransfer={onTransfer}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
