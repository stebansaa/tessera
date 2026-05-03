import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { useTheme } from "../lib/theme";
import { getScheme } from "../lib/color-schemes";
import { OptimisticEchoController } from "../lib/optimistic-echo";
import type { BriefTerminalEvent } from "../shared/ipc";

// Generic monospace fallback chain appended to whatever the user picks,
// so unknown font names degrade to something readable.
const FONT_FALLBACK =
  ', "JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

// Braille spinner — same set most CLI tools use. One frame ~80ms ≈ 12 fps,
// which is plenty for "I'm doing something" feedback without burning CPU.
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;
const PASTE_CHUNK_SIZE = 128;
const PASTE_CHUNK_DELAY_MS = 12;
const PASTE_NEWLINE_DELAY_MS = 24;
const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";
const TERMINAL_SCROLLBACK_LINES = 20_000;
const TEXT_ENCODER = new TextEncoder();

interface WritePart {
  data: string;
  delayAfterMs: number;
}

export type TerminalTransferDirection = "upload" | "download";

export interface TerminalTransferEvent {
  ts: number;
  sessionId: string;
  tabId: string;
  direction: TerminalTransferDirection;
  bytes: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function byteLength(data: string): number {
  return TEXT_ENCODER.encode(data).byteLength;
}

function pasteChunks(data: string): string[] {
  const chunks: string[] = [];
  let chunk = "";
  let count = 0;
  for (const ch of data) {
    chunk += ch;
    count += 1;
    if (count >= PASTE_CHUNK_SIZE) {
      chunks.push(chunk);
      chunk = "";
      count = 0;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function delayAfterWrite(data: string): number {
  if (data.length <= 1) return 0;
  return data.includes("\n") || data.includes("\r")
    ? PASTE_NEWLINE_DELAY_MS
    : PASTE_CHUNK_DELAY_MS;
}

function appendPasteChunks(parts: WritePart[], data: string) {
  for (const chunk of pasteChunks(data)) {
    parts.push({ data: chunk, delayAfterMs: delayAfterWrite(chunk) });
  }
}

function ptyWriteParts(data: string): WritePart[] {
  if (data.length <= 1) return [{ data, delayAfterMs: 0 }];

  const start = data.indexOf(BRACKETED_PASTE_START);
  const end = data.lastIndexOf(BRACKETED_PASTE_END);

  if (start === -1 || end === -1 || end < start) {
    const parts: WritePart[] = [];
    appendPasteChunks(parts, data);
    return parts;
  }

  const parts: WritePart[] = [];
  const before = data.slice(0, start);
  const body = data.slice(start + BRACKETED_PASTE_START.length, end);
  const after = data.slice(end + BRACKETED_PASTE_END.length);

  appendPasteChunks(parts, before);
  parts.push({ data: BRACKETED_PASTE_START, delayAfterMs: 0 });
  appendPasteChunks(parts, body);
  parts.push({ data: BRACKETED_PASTE_END, delayAfterMs: PASTE_CHUNK_DELAY_MS });
  appendPasteChunks(parts, after);
  return parts;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const mon = d.toLocaleString("en-US", { month: "short" });
  const day = d.getDate();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${mon} ${day} ${h}:${m}`;
}

interface Props {
  /** Session id this terminal is bound to. When set, main routes the
   *  spawn through SQLite to pick local-pty vs ssh based on session.kind. */
  sessionId?: string;
  /** Stable tab id used by the live brief panel to attribute output. */
  tabId?: string;
  /** Optional label shown in the connecting overlay (e.g. "root@1.2.3.4").
   *  When omitted (local PTY) the overlay is skipped entirely since local
   *  shells spawn instantly and the flash would just be visual noise. */
  connectingLabel?: string;
  optimisticEcho?: boolean;
  onBriefEvent?: (event: BriefTerminalEvent) => void;
  onTransfer?: (event: TerminalTransferEvent) => void;
}

export function TerminalView({
  sessionId,
  tabId,
  connectingLabel,
  optimisticEcho = false,
  onBriefEvent,
  onTransfer,
}: Props) {
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
  const briefEventRef = useRef<typeof onBriefEvent>(onBriefEvent);
  const transferEventRef = useRef<typeof onTransfer>(onTransfer);
  const optimisticEchoRef = useRef(new OptimisticEchoController());
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const ptyGenerationRef = useRef(0);
  const { theme } = useTheme();
  const { fontFamily, fontSize, colorScheme } = theme;
  const scheme = getScheme(colorScheme);

  // Stash initial values so the mount effect can read them without
  // re-running when the theme changes (mount effect needs `[]` deps
  // so the PTY isn't recreated on every theme tweak).
  const initialRef = useRef({ fontFamily, fontSize, scheme });

  useEffect(() => {
    briefEventRef.current = onBriefEvent;
  }, [onBriefEvent]);

  useEffect(() => {
    transferEventRef.current = onTransfer;
  }, [onTransfer]);

  useEffect(() => {
    optimisticEchoRef.current.setEnabled(optimisticEcho);
  }, [optimisticEcho]);

  const emitBriefEvent = useCallback(
    (stream: BriefTerminalEvent["stream"], text: string) => {
      if (!sessionId || !tabId || !text) return;
      briefEventRef.current?.({
        ts: Date.now(),
        sessionId,
        tabId,
        stream,
        text,
      });
    },
    [sessionId, tabId],
  );

  const emitTransferEvent = useCallback(
    (direction: TerminalTransferDirection, data: string) => {
      if (!sessionId || !tabId || !data) return;
      const bytes = byteLength(data);
      if (bytes <= 0) return;
      transferEventRef.current?.({
        ts: Date.now(),
        sessionId,
        tabId,
        direction,
        bytes,
      });
    },
    [sessionId, tabId],
  );

  const queuePtyWrite = useCallback((data: string) => {
    if (!data) return;
    const ptyId = ptyIdRef.current;
    if (!ptyId || exitedRef.current) return;
    const generation = ptyGenerationRef.current;
    const reportTransfer = data.length > 1;

    writeQueueRef.current = writeQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (ptyGenerationRef.current !== generation || exitedRef.current) return;
        const currentPtyId = ptyIdRef.current;
        if (!currentPtyId || currentPtyId !== ptyId) return;

        for (const part of ptyWriteParts(data)) {
          if (ptyGenerationRef.current !== generation || exitedRef.current) return;
          if (ptyIdRef.current !== ptyId) return;
          await window.api.pty.write({ ptyId, data: part.data });
          if (reportTransfer) emitTransferEvent("upload", part.data);
          if (part.delayAfterMs > 0) await sleep(part.delayAfterMs);
        }
      });
  }, [emitTransferEvent]);

  const pasteIntoTerminal = useCallback((text: string) => {
    const term = termRef.current;
    if (!term || !text || !ptyIdRef.current || exitedRef.current) return;
    term.focus();
    // xterm normalizes newlines and applies bracketed paste mode for TUIs
    // such as Codex, shells with readline, vim, nano, and other editors.
    term.paste(text);
  }, []);

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
      ptyGenerationRef.current += 1;

      disposeDataRef.current?.();
      disposeExitRef.current?.();

      disposeDataRef.current = window.api.pty.onData(id, (data) => {
        setHasReceivedData(true);
        emitTransferEvent("download", data);
        const visibleData = optimisticEchoRef.current.handleRemoteData(data);
        if (visibleData) term.write(visibleData);
        emitBriefEvent("output", data);
      });

      disposeExitRef.current = window.api.pty.onExit(id, (info) => {
        const code =
          info.exitCode != null ? `exit ${info.exitCode}` : "killed";
        const ts = Date.now();
        const time = fmtTime(ts);
        const text = ` Disconnected · ${time} · ${code} `;
        const pad = Math.max(0, term.cols - text.length - 2);
        term.write(
          `\r\n\x1b[2;31m─${text}${"─".repeat(pad)}\x1b[0m\r\n`,
        );
        emitBriefEvent("system", text);
        setExited(true);
        exitedRef.current = true;
      });
    },
    [emitBriefEvent, emitTransferEvent],
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
      scrollback: TERMINAL_SCROLLBACK_LINES,
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: "bar",
      allowTransparency: true,
      ignoreBracketedPasteMode: false,
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
        const localEcho = optimisticEchoRef.current.handleLocalInput(data);
        if (localEcho) term.write(localEcho);
        queuePtyWrite(data);
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
          pasteIntoTerminal(text);
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

    return () => {
      container.removeEventListener("contextmenu", onContextMenu);
      disposed = true;
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      disposeDataRef.current?.();
      disposeExitRef.current?.();
      if (ptyIdRef.current) window.api.pty.kill({ ptyId: ptyIdRef.current });
      ptyGenerationRef.current += 1;
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
      pasteIntoTerminal(text);
    });
    setCtxMenu(null);
  }, [pasteIntoTerminal]);

  const ctxSelectAll = useCallback(() => {
    termRef.current?.selectAll();
    setCtxMenu(null);
  }, []);

  return (
    <div className="group/term relative h-full w-full">
      <div ref={ref} className="h-full w-full" />
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
