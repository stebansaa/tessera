import { TerminalView } from "./TerminalView";

/**
 * Renders one TerminalView per tab and only shows the active one.
 *
 * Inactive tabs use `visibility: hidden` (not `display: none`) so the
 * underlying div keeps its layout dimensions — that's what xterm's
 * FitAddon needs to compute the cell grid correctly. With display:none
 * the terminal would mount at 0×0 and only fix itself on the next
 * resize, which makes tab switches feel broken.
 *
 * Each TerminalView has a stable `key` so it stays mounted across
 * tab switches — its PTY keeps running in the background.
 */
interface Props {
  /** Session id — passed down so each TerminalView can tell main which
   *  session it's spawning for (local PTY vs SSH is decided in main). */
  sessionId: string;
  tabIds: string[];
  activeTabId: string | null;
  /** Optional "user@host" label, set only for SSH sessions, used by
   *  TerminalView to render the connecting overlay before first byte. */
  connectingLabel?: string;
}

export function TerminalTabs({
  sessionId,
  tabIds,
  activeTabId,
  connectingLabel,
}: Props) {
  return (
    <div className="relative h-full w-full">
      {tabIds.map((id) => {
        const visible = id === activeTabId;
        return (
          <div
            key={id}
            className="absolute inset-0"
            style={{
              visibility: visible ? "visible" : "hidden",
              // Stack the active tab on top so cursor/clicks land on it.
              zIndex: visible ? 1 : 0,
            }}
          >
            <TerminalView
              sessionId={sessionId}
              connectingLabel={connectingLabel}
            />
          </div>
        );
      })}
    </div>
  );
}
