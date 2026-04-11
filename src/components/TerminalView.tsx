import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Eraser } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import { useTheme } from "../lib/theme";
import { getScheme } from "../lib/color-schemes";

// Generic monospace fallback chain appended to whatever the user picks,
// so unknown font names degrade to something readable.
const FONT_FALLBACK =
  ', "JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

// Braille spinner — same set most CLI tools use. One frame ~80ms ≈ 12 fps,
// which is plenty for "I'm doing something" feedback without burning CPU.
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;

/** How many transcript chunks to load on mount and per scroll-back page. */
const TRANSCRIPT_PAGE_SIZE = 200;

/** Max bytes to replay on mount. Keeps high-throughput sessions fast. */
const REPLAY_BYTE_CAP = 256 * 1024;

/**
 * Format an epoch-ms timestamp into a short "Apr 9 14:32" string.
 */
function fmtTime(ts: number): string {
  const d = new Date(ts);
  const mon = d.toLocaleString("en-US", { month: "short" });
  const day = d.getDate();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${mon} ${day} ${h}:${m}`;
}

/**
 * Render an event chunk (JSON body) as an ANSI-styled divider line.
 * Returns the ANSI string to write into xterm.
 */
function renderEventDivider(json: string, cols: number): string {
  try {
    const evt = JSON.parse(json) as {
      type: string;
      label?: string;
      exitCode?: number | null;
      signal?: number | null;
      ts?: number;
    };
    const time = evt.ts ? fmtTime(evt.ts) : "";
    let text: string;
    if (evt.type === "connected") {
      text = ` Connected to ${evt.label ?? "shell"} · ${time} `;
    } else if (evt.type === "disconnected") {
      const code =
        evt.exitCode != null ? `exit ${evt.exitCode}` : "killed";
      text = ` Disconnected · ${time} · ${code} `;
    } else {
      text = ` ${evt.type} · ${time} `;
    }
    // Pad with ─ to fill the terminal width.
    const pad = Math.max(0, cols - text.length - 2);
    const left = "─";
    const right = "─".repeat(pad);
    // dim + yellow-ish for connected, dim + red-ish for disconnected
    const color = evt.type === "connected" ? "32" : "31"; // green / red
    return `\r\n\x1b[2;${color}m${left}${text}${right}\x1b[0m\r\n`;
  } catch {
    return `\r\n\x1b[2m── event ──\x1b[0m\r\n`;
  }
}

interface Props {
  /** Session id this terminal is bound to. When set, main routes the
   *  spawn through SQLite to pick local-pty vs ssh based on session.kind. */
  sessionId?: string;
  /** Unique tab id — used to distinguish multiple terminal tabs within
   *  the same session. */
  tabId?: string;
  /** When true this is the primary terminal tab for the session and its
   *  transcript history is replayed on mount. Secondary tabs start fresh. */
  isFirstTab?: boolean;
  /** Optional label shown in the connecting overlay (e.g. "root@1.2.3.4").
   *  When omitted (local PTY) the overlay is skipped entirely since local
   *  shells spawn instantly and the flash would just be visual noise. */
  connectingLabel?: string;
}

export function TerminalView({ sessionId, tabId, isFirstTab = true, connectingLabel }: Props) {
  // Connecting overlay is only meaningful for SSH — local PTYs are
  // ready before paint. We track first-byte-received separately from
  // the label so the overlay reacts correctly when the label resolves
  // *after* mount (SessionPanel fetches host/user via IPC).
  const [hasReceivedData, setHasReceivedData] = useState(false);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const showConnecting = !!connectingLabel && !hasReceivedData;

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement | null>(null);

  // Exited state — shown after the PTY exits. Enables the reconnect
  // overlay and the Enter-to-reconnect shortcut.
  const [exited, setExited] = useState(false);
  const exitedRef = useRef(false);
  // Guard against double-reconnect from rapid Enter presses.
  const reconnectingRef = useRef(false);

  useEffect(() => {
    if (!showConnecting) return;
    const t = setInterval(() => {
      setSpinnerFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL_MS);
    return () => clearInterval(t);
  }, [showConnecting]);

  const ref = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  // Disposers for the current ptyId's IPC listeners. Promoted from closure
  // vars to refs so the reconnect function can tear down the old listeners.
  const disposeDataRef = useRef<(() => void) | null>(null);
  const disposeExitRef = useRef<(() => void) | null>(null);
  // Transcript pagination — tracks whether there are older chunks to load
  // and the lowest seq we've loaded so far, used as the `before` cursor.
  const hasMoreRef = useRef(false);
  const oldestSeqRef = useRef<number | null>(null);
  const loadingMoreRef = useRef(false);
  const { theme } = useTheme();
  const { fontFamily, fontSize, colorScheme } = theme;
  const scheme = getScheme(colorScheme);

  // Stash initial values so the mount effect can read them without
  // re-running when the theme changes (mount effect needs `[]` deps
  // so the PTY isn't recreated on every theme tweak).
  const initialRef = useRef({ fontFamily, fontSize, scheme });

  // Push font + color changes onto the live terminal without tearing down the PTY.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontFamily = `"${fontFamily}"${FONT_FALLBACK}`;
    term.options.fontSize = fontSize;
    term.options.theme = scheme.terminal;
    // Refit so cell-grid math reflects the new metrics, then tell the PTY.
    fitRef.current?.fit();
    if (ptyIdRef.current) {
      window.api.pty.resize({
        ptyId: ptyIdRef.current,
        cols: term.cols,
        rows: term.rows,
      });
    }
  }, [fontFamily, fontSize, scheme]);

  /**
   * Wire a ptyId to the existing Terminal instance. Subscribes to data/exit
   * events, hooks up user input, and updates refs. Returns a cleanup
   * function that disposes the listeners.
   */
  const wirePty = useCallback(
    (term: Terminal, id: string) => {
      ptyIdRef.current = id;

      disposeDataRef.current?.();
      disposeExitRef.current?.();

      disposeDataRef.current = window.api.pty.onData(id, (data) => {
        setHasReceivedData(true);
        term.write(data);
      });

      disposeExitRef.current = window.api.pty.onExit(id, (info) => {
        // Render a disconnected divider immediately (the same data is
        // being persisted by the TranscriptWriter on the main side, so
        // on next replay the same line appears from the stored event).
        const code =
          info.exitCode != null ? `exit ${info.exitCode}` : "killed";
        const ts = Date.now();
        const time = fmtTime(ts);
        const text = ` Disconnected · ${time} · ${code} `;
        const pad = Math.max(0, term.cols - text.length - 2);
        term.write(
          `\r\n\x1b[2;31m─${text}${"─".repeat(pad)}\x1b[0m\r\n`,
        );
        setExited(true);
        exitedRef.current = true;
      });
    },
    // setState setters are stable; sessionId is captured at mount time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * Spawn a new PTY for the same session (reconnect). Reuses the existing
   * Terminal instance so scrollback history is preserved.
   */
  const reconnect = useCallback(async () => {
    const term = termRef.current;
    if (!term || reconnectingRef.current) return;
    reconnectingRef.current = true;

    setExited(false);
    exitedRef.current = false;
    setHasReceivedData(false);

    // The "connected" divider is also written by the TranscriptWriter
    // on the main side once the spawn succeeds. Here we render it
    // immediately for feedback — the replayed version on next launch
    // will match because both use the same event shape.

    try {
      const { ptyId: newId } = await window.api.pty.spawn({
        sessionId,
        cols: term.cols,
        rows: term.rows,
      });
      wirePty(term, newId);
    } catch (err) {
      term.writeln(
        `\r\n\x1b[31mReconnect failed: ${(err as Error).message}\x1b[0m`,
      );
      setExited(true);
      exitedRef.current = true;
    } finally {
      reconnectingRef.current = false;
    }
  }, [sessionId, wirePty]);

  useEffect(() => {
    if (!ref.current) return;
    const initial = initialRef.current;

    const term = new Terminal({
      fontFamily: `"${initial.fontFamily}"${FONT_FALLBACK}`,
      fontSize: initial.fontSize,
      scrollback: 50000,
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: "bar",
      allowTransparency: true,
      rightClickSelectsWord: true,
      theme: initial.scheme.terminal,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());

    term.open(ref.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    // GPU-accelerated rendering — required by spec.
    // Falls through to canvas only if WebGL fails.
    let webgl: WebglAddon | null = null;
    try {
      webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl?.dispose();
        webgl = null;
      });
      term.loadAddon(webgl);
    } catch (err) {
      console.warn("[Terminal] WebGL renderer unavailable:", err);
    }

    let disposed = false;

    (async () => {
      // Replay the most recent transcript page from SQLite before spawning.
      // Only the first (primary) terminal tab replays history — secondary
      // tabs start with a clean slate.
      if (sessionId && isFirstTab) {
        try {
          const { chunks, hasMore } = await window.api.transcripts.load({
            sessionId,
            limit: TRANSCRIPT_PAGE_SIZE,
          });
          if (disposed) return;
          // Cap replay by byte size so high-throughput sessions (e.g.
          // minutes of `ping`) don't freeze the terminal on mount.
          // Walk backwards from the end to find which chunks fit.
          let replayBytes = 0;
          let startIdx = chunks.length;
          for (let i = chunks.length - 1; i >= 0; i--) {
            replayBytes += chunks[i].contentText.length;
            if (replayBytes > REPLAY_BYTE_CAP) break;
            startIdx = i;
          }
          const trimmedChunks = chunks.slice(startIdx);
          const trimmedHasMore = hasMore || startIdx > 0;

          hasMoreRef.current = trimmedHasMore;
          if (trimmedChunks.length > 0) {
            oldestSeqRef.current = trimmedChunks[0].seq;
            if (trimmedHasMore) {
              term.writeln(
                "\x1b[2m── scroll up to load older history ──\x1b[0m",
              );
            }
          }
          // Batch all chunks into a single string before writing to xterm.
          let replay = "";
          for (const chunk of trimmedChunks) {
            if (chunk.chunkType === "event") {
              replay += renderEventDivider(chunk.contentText, term.cols);
            } else {
              replay += chunk.contentText;
            }
          }
          if (replay) term.write(replay);
        } catch (err) {
          console.warn("[TerminalView] transcript load failed:", err);
        }
      }

      try {
        const { ptyId: id } = await window.api.pty.spawn({
          sessionId,
          cols: term.cols,
          rows: term.rows,
        });
        if (disposed) {
          window.api.pty.kill({ ptyId: id });
          return;
        }
        wirePty(term, id);
      } catch (err) {
        term.writeln(
          `\r\n\x1b[31mFailed to spawn PTY: ${(err as Error).message}\x1b[0m`,
        );
        setExited(true);
        exitedRef.current = true;
      }
    })();

    // User input — intercept Enter when exited for reconnect shortcut.
    term.onData((data) => {
      if (exitedRef.current && data === "\r") {
        reconnect();
        return;
      }
      if (ptyIdRef.current && !exitedRef.current) {
        window.api.pty.write({ ptyId: ptyIdRef.current, data });
      }
    });

    // Right-click opens context menu with Copy / Paste / Select All.
    const container = ref.current!;
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      setCtxMenu({ x: e.clientX, y: e.clientY });
    };
    container.addEventListener("contextmenu", onContextMenu);

    // Ctrl+Shift+C / Ctrl+Shift+V for copy/paste.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      if (e.ctrlKey && e.shiftKey && e.code === "KeyC") {
        const sel = term.getSelection();
        if (sel) navigator.clipboard.writeText(sel);
        return false;
      }
      if (e.ctrlKey && e.shiftKey && e.code === "KeyV") {
        navigator.clipboard.readText().then((text) => {
          if (text && ptyIdRef.current && !exitedRef.current) {
            window.api.pty.write({ ptyId: ptyIdRef.current, data: text });
          }
        });
        return false;
      }
      return true;
    });

    const onResize = () => {
      fit.fit();
      if (ptyIdRef.current && !exitedRef.current) {
        window.api.pty.resize({
          ptyId: ptyIdRef.current,
          cols: term.cols,
          rows: term.rows,
        });
      }
    };
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(ref.current);

    // Lazy-load older transcript pages when the user scrolls to the top
    // of the scrollback buffer. xterm fires onScroll with the new
    // viewportY; when it hits 0 we fetch the previous page.
    const scrollDispose = term.onScroll(() => {
      if (
        !sessionId ||
        !hasMoreRef.current ||
        loadingMoreRef.current ||
        term.buffer.active.viewportY > 0
      ) {
        return;
      }
      loadingMoreRef.current = true;
      const before = oldestSeqRef.current ?? undefined;
      window.api.transcripts
        .load({ sessionId, before, limit: TRANSCRIPT_PAGE_SIZE })
        .then(({ chunks, hasMore }) => {
          if (disposed || chunks.length === 0) {
            loadingMoreRef.current = false;
            hasMoreRef.current = false;
            return;
          }
          hasMoreRef.current = hasMore;
          oldestSeqRef.current = chunks[0].seq;

          // Build the full replay string for the older page, then
          // prepend it. We use a write at the very start of the
          // buffer — xterm doesn't support direct buffer prepend, so
          // we save cursor, go to top, insert lines, write content,
          // and restore. This is imperfect for ANSI state but good
          // enough for scrollback history.
          let content = hasMore
            ? "\x1b[2m── scroll up to load older history ──\x1b[0m\r\n"
            : "";
          for (const chunk of chunks) {
            content +=
              chunk.chunkType === "event"
                ? renderEventDivider(chunk.contentText, term.cols)
                : chunk.contentText;
          }
          // Count approximate lines added so we can adjust scroll.
          const lineCount = content.split("\n").length;

          // Save state, scroll to top, insert blank lines, write
          // content at those lines, restore position.
          term.write("\x1b7"); // DECSC save cursor
          term.write(`\x1b[${lineCount}S`); // scroll up N lines
          term.write("\x1b[H"); // cursor to top-left
          term.write(content);
          term.write("\x1b8"); // DECRC restore cursor

          loadingMoreRef.current = false;
        })
        .catch(() => {
          loadingMoreRef.current = false;
        });
    });

    return () => {
      scrollDispose.dispose();
      container.removeEventListener("contextmenu", onContextMenu);
      disposed = true;
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      disposeDataRef.current?.();
      disposeExitRef.current?.();
      if (ptyIdRef.current) window.api.pty.kill({ ptyId: ptyIdRef.current });
      webgl?.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      ptyIdRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close context menu on any click or keypress outside it.
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [ctxMenu]);

  const ctxCopy = useCallback(() => {
    const sel = termRef.current?.getSelection();
    if (sel) navigator.clipboard.writeText(sel);
    setCtxMenu(null);
  }, []);

  const ctxPaste = useCallback(() => {
    navigator.clipboard.readText().then((text) => {
      if (text && ptyIdRef.current && !exitedRef.current) {
        window.api.pty.write({ ptyId: ptyIdRef.current, data: text });
      }
    });
    setCtxMenu(null);
  }, []);

  const ctxSelectAll = useCallback(() => {
    termRef.current?.selectAll();
    setCtxMenu(null);
  }, []);

  const clearHistory = useCallback(async () => {
    if (!sessionId) return;
    const ok = window.confirm(
      "Clear all saved history for this connection?\n\nThis removes the stored transcript permanently. The live terminal session is not affected.",
    );
    if (!ok) return;
    try {
      await window.api.transcripts.clear({ id: sessionId });
    } catch (err) {
      console.error("[TerminalView] clear transcript failed:", err);
    }
    const term = termRef.current;
    if (term) {
      term.clear();
      term.write("\x1b[2m── history cleared ──\x1b[0m\r\n");
    }
    hasMoreRef.current = false;
    oldestSeqRef.current = null;
  }, [sessionId]);

  return (
    <div className="group/term relative h-full w-full">
      <div ref={ref} className="h-full w-full" />
      {sessionId && isFirstTab && !showConnecting && (
        <button
          onClick={clearHistory}
          title="Clear history"
          className="absolute right-2 top-2 z-10 rounded p-1.5 text-fg-muted opacity-0 transition hover:bg-white/[0.08] hover:text-fg group-hover/term:opacity-100"
        >
          <Eraser size={14} />
        </button>
      )}
      {showConnecting && connectingLabel && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-bg/85">
          <div className="flex items-center gap-3 rounded-md border border-divider bg-bg-header px-4 py-2.5 text-sm text-fg-bright shadow-lg">
            <span className="font-mono text-base text-accent">
              {SPINNER_FRAMES[spinnerFrame]}
            </span>
            <span>
              Connecting to{" "}
              <span className="text-fg-bright">{connectingLabel}</span>…
            </span>
          </div>
        </div>
      )}
      {exited && (
        <div className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-center pb-8">
          <div className="flex items-center gap-3 rounded-md border border-divider bg-bg-header px-4 py-2.5 text-sm text-fg-bright shadow-lg">
            <span className="text-fg-dim">Connection closed.</span>
            <button
              onClick={reconnect}
              className="rounded bg-accent/20 px-3 py-1 text-accent transition hover:bg-accent/30"
            >
              Reconnect
            </button>
            <span className="text-[11px] text-fg-muted">or press Enter</span>
          </div>
        </div>
      )}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          onMouseDown={(e) => e.stopPropagation()}
          className="fixed z-50 min-w-[160px] rounded-md border border-divider bg-bg-header py-1 text-sm text-fg shadow-xl"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <button
            onClick={ctxCopy}
            className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-white/[0.08]"
          >
            <span>Copy</span>
            <span className="text-[11px] text-fg-muted">Ctrl+Shift+C</span>
          </button>
          <button
            onClick={ctxPaste}
            className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-white/[0.08]"
          >
            <span>Paste</span>
            <span className="text-[11px] text-fg-muted">Ctrl+Shift+V</span>
          </button>
          <div className="my-1 border-t border-divider" />
          <button
            onClick={ctxSelectAll}
            className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-white/[0.08]"
          >
            <span>Select All</span>
          </button>
        </div>
      )}
    </div>
  );
}
