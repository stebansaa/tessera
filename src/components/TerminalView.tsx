import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

export function TerminalView() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;

    const term = new Terminal({
      fontFamily:
        '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: "bar",
      allowTransparency: true,
      theme: {
        background: "#15161a",
        foreground: "#dee0e8",
        cursor: "#73baf7",
        cursorAccent: "#15161a",
        selectionBackground: "#5fb3fa55",
        black: "#1c1d22",
        red: "#e06c75",
        green: "#98c379",
        yellow: "#e5c07b",
        blue: "#61afef",
        magenta: "#c678dd",
        cyan: "#56b6c2",
        white: "#dee0e8",
        brightBlack: "#5c6370",
        brightRed: "#e06c75",
        brightGreen: "#98c379",
        brightYellow: "#e5c07b",
        brightBlue: "#61afef",
        brightMagenta: "#c678dd",
        brightCyan: "#56b6c2",
        brightWhite: "#f9faff",
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());

    term.open(ref.current);
    fit.fit();

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

    let ptyId: string | null = null;
    let disposeData: (() => void) | null = null;
    let disposeExit: (() => void) | null = null;
    let disposed = false;

    (async () => {
      try {
        const { ptyId: id } = await window.api.pty.spawn({
          cols: term.cols,
          rows: term.rows,
        });
        if (disposed) {
          window.api.pty.kill({ ptyId: id });
          return;
        }
        ptyId = id;

        disposeData = window.api.pty.onData(id, (data) => term.write(data));
        disposeExit = window.api.pty.onExit(id, () => {
          term.writeln("\r\n\x1b[2m[process exited]\x1b[0m");
        });

        term.onData((data) => {
          window.api.pty.write({ ptyId: id, data });
        });
      } catch (err) {
        term.writeln(
          `\r\n\x1b[31mFailed to spawn PTY: ${(err as Error).message}\x1b[0m`,
        );
      }
    })();

    const onResize = () => {
      fit.fit();
      if (ptyId) {
        window.api.pty.resize({ ptyId, cols: term.cols, rows: term.rows });
      }
    };
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(ref.current);

    return () => {
      disposed = true;
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      disposeData?.();
      disposeExit?.();
      if (ptyId) window.api.pty.kill({ ptyId });
      webgl?.dispose();
      term.dispose();
    };
  }, []);

  return <div ref={ref} className="h-full w-full" />;
}
