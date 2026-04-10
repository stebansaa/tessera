import { app, BrowserWindow, ipcMain, Menu, shell } from "electron";
import { join } from "path";
import { randomUUID } from "crypto";
import { spawn as ptySpawn } from "node-pty";
import { IPC } from "../../src/shared/ipc";
import type {
  PtySpawnRequest,
  PtySpawnResponse,
  PtyWriteRequest,
  PtyResizeRequest,
  PtyKillRequest,
  ConnectionStatusEvent,
} from "../../src/shared/ipc";
import { getDb, closeDb } from "../db/client";
import { createRepo, type Repo } from "../db/repo";
import { seedIfEmpty, seedServersyncOnce } from "../db/seed";
import { registerProjectHandlers } from "../ipc/projects";
import { registerSessionHandlers } from "../ipc/sessions";
import { registerSettingsHandlers } from "../ipc/settings";
import { registerDialogHandlers } from "../ipc/dialog";
import { registerTranscriptHandlers } from "../ipc/transcripts";
import { registerSearchHandlers } from "../ipc/search";
import { spawnSsh, type Connection } from "../ssh/spawn";
import { TranscriptWriter } from "../pty/transcript-writer";

// ── Connection pool ────────────────────────────────────────────────
//
// Holds both local PTYs (node-pty) and SSH shell channels (ssh2) behind
// a uniform Connection interface so the rest of main doesn't care which
// backend a given tab is using.

const connections = new Map<string, Connection>();
/** sessionId → set of live ptyIds. Lets us know when a session is connected. */
const sessionPtys = new Map<string, Set<string>>();
/** Reverse lookup: ptyId → sessionId. Needed by the kill handler. */
const ptyToSession = new Map<string, string>();
/** Per-ptyId transcript writers — buffer PTY output → SQLite chunks. */
const writers = new Map<string, TranscriptWriter>();

/** Wrap a node-pty IPty in our Connection shape. */
function wrapLocalPty(opts: {
  shell?: string;
  cwd?: string;
  cols: number;
  rows: number;
  env?: Record<string, string>;
}): Connection {
  const shellPath =
    opts.shell ||
    process.env.SHELL ||
    (process.platform === "win32" ? "powershell.exe" : "/bin/bash");
  const cwd = opts.cwd || app.getPath("home");

  const pty = ptySpawn(shellPath, [], {
    name: "xterm-256color",
    cols: opts.cols,
    rows: opts.rows,
    cwd,
    env: { ...process.env, ...(opts.env ?? {}) } as Record<string, string>,
  });

  return {
    write: (d) => pty.write(d),
    resize: (c, r) => pty.resize(c, r),
    kill: () => {
      try {
        pty.kill();
      } catch {
        /* noop */
      }
    },
    onData: (h) => {
      pty.onData(h);
    },
    onExit: (h) => {
      pty.onExit(({ exitCode, signal }) => h({ exitCode, signal }));
    },
  };
}

/** Push a connection-status update to the renderer for one session. */
function broadcastConnStatus(win: BrowserWindow, sessionId: string) {
  if (win.isDestroyed()) return;
  const liveCount = sessionPtys.get(sessionId)?.size ?? 0;
  const evt: ConnectionStatusEvent = { sessionId, liveCount };
  win.webContents.send(IPC.pty.connStatus, evt);
}

/** Register a ptyId as belonging to a session (bookkeeping for status). */
function trackPty(sessionId: string, ptyId: string) {
  const set = sessionPtys.get(sessionId) ?? new Set();
  set.add(ptyId);
  sessionPtys.set(sessionId, set);
  ptyToSession.set(ptyId, sessionId);
}

/** Remove a ptyId from session tracking and return the sessionId. */
function untrackPty(ptyId: string): string | undefined {
  const sessionId = ptyToSession.get(ptyId);
  ptyToSession.delete(ptyId);
  if (sessionId) {
    const set = sessionPtys.get(sessionId);
    if (set) {
      set.delete(ptyId);
      if (set.size === 0) sessionPtys.delete(sessionId);
    }
  }
  return sessionId;
}

function registerPtyHandlers(win: BrowserWindow, repo: Repo) {
  ipcMain.handle(
    IPC.pty.spawn,
    async (_evt, req: PtySpawnRequest): Promise<PtySpawnResponse> => {
      let conn: Connection;

      // SSH branch — only when the request is bound to a session AND that
      // session is a terminal/ssh row in the DB. Anything else falls
      // through to the local PTY branch.
      const details = req.sessionId
        ? repo.getSessionDetails(req.sessionId)
        : null;

      if (
        details &&
        details.kind === "ssh" &&
        details.terminal &&
        details.terminal.host &&
        details.terminal.username
      ) {
        const t = details.terminal;
        const password =
          t.authMethod === "password"
            ? repo.getSshPassword(details.id)
            : null;
        conn = await spawnSsh({
          host: t.host!,
          port: t.port ?? 22,
          username: t.username!,
          cols: req.cols,
          rows: req.rows,
          identityFile: t.authMethod === "key" ? t.identityFile : null,
          password,
        });
      } else {
        conn = wrapLocalPty({
          shell: req.shell,
          cwd: req.cwd,
          cols: req.cols,
          rows: req.rows,
          env: req.env,
        });
      }

      const ptyId = randomUUID();
      connections.set(ptyId, conn);

      // Track this ptyId against its session for status broadcasting.
      if (req.sessionId) {
        trackPty(req.sessionId, ptyId);
        broadcastConnStatus(win, req.sessionId);
      }

      // Bump last_used_at so the RECENT section in the sidebar moves
      // this session to the top on next list call.
      if (req.sessionId) {
        try {
          repo.touchSession(req.sessionId);
        } catch (err) {
          console.warn("[main] touchSession failed:", err);
        }
      }

      // ── Transcript writer ──────────────────────────────────────
      // Create a run and a writer that buffers PTY output → SQLite.
      let writer: TranscriptWriter | null = null;
      if (req.sessionId) {
        try {
          const runId = repo.createRun(req.sessionId);
          const seq = repo.nextSeq(req.sessionId);
          writer = new TranscriptWriter(repo, req.sessionId, runId, seq);
          writers.set(ptyId, writer);

          // "Connected" event marker — rendered as a divider on replay.
          const label =
            details?.kind === "ssh" && details.terminal
              ? `${details.terminal.username ?? ""}@${details.terminal.host ?? ""}`
              : "local shell";
          writer.writeEvent(
            JSON.stringify({
              type: "connected",
              label,
              ts: Date.now(),
            }),
          );
        } catch (err) {
          console.warn("[main] transcript writer setup failed:", err);
        }
      }

      conn.onData((data) => {
        if (!win.isDestroyed()) {
          win.webContents.send(`${IPC.pty.dataPrefix}${ptyId}`, data);
        }
        writer?.write(data);
      });

      conn.onExit(({ exitCode, signal }) => {
        // Write "disconnected" event before flushing/closing the writer.
        const w = writers.get(ptyId);
        if (w) {
          w.writeEvent(
            JSON.stringify({
              type: "disconnected",
              exitCode,
              signal: signal ?? null,
              ts: Date.now(),
            }),
          );
          w.close();
          try {
            repo.endRun(
              w.runId,
              exitCode === 0 ? "ended" : "crashed",
            );
          } catch (err) {
            console.warn("[main] endRun failed:", err);
          }
          writers.delete(ptyId);
        }

        if (!win.isDestroyed()) {
          win.webContents.send(`${IPC.pty.exitPrefix}${ptyId}`, {
            exitCode,
            signal,
          });
        }
        connections.delete(ptyId);
        const sid = untrackPty(ptyId);
        if (sid) broadcastConnStatus(win, sid);
      });

      return { ptyId };
    },
  );

  ipcMain.handle(IPC.pty.write, async (_evt, req: PtyWriteRequest) => {
    connections.get(req.ptyId)?.write(req.data);
  });

  ipcMain.handle(IPC.pty.resize, async (_evt, req: PtyResizeRequest) => {
    connections.get(req.ptyId)?.resize(req.cols, req.rows);
  });

  ipcMain.handle(IPC.pty.kill, async (_evt, req: PtyKillRequest) => {
    // Flush + close transcript writer before killing the connection.
    const w = writers.get(req.ptyId);
    if (w) {
      w.writeEvent(
        JSON.stringify({ type: "disconnected", exitCode: null, signal: null, ts: Date.now() }),
      );
      w.close();
      try {
        repo.endRun(w.runId, "ended");
      } catch { /* noop */ }
      writers.delete(req.ptyId);
    }
    connections.get(req.ptyId)?.kill();
    connections.delete(req.ptyId);
    const sid = untrackPty(req.ptyId);
    if (sid) broadcastConnStatus(win, sid);
  });

  // Snapshot of all live session connections — renderer calls on mount.
  ipcMain.handle(IPC.pty.connStatusSnapshot, async () => {
    const result: Record<string, number> = {};
    for (const [sessionId, ptys] of sessionPtys.entries()) {
      if (ptys.size > 0) result[sessionId] = ptys.size;
    }
    return result;
  });
}

// ── Window ─────────────────────────────────────────────────────────

function createWindow(repo: Repo) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "Tessera",
    backgroundColor: "#15161a",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // node-pty needs this off for the preload to load native modules
    },
  });

  win.once("ready-to-show", () => win.show());

  // Open external links in the system browser instead of navigating
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Dev vs prod
  if (process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  // ── Application menu ───────────────────────────────────────────
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Tab",
          accelerator: "CmdOrCtrl+T",
          click: () => win.webContents.send(IPC.shortcuts.action, "newTab"),
        },
        {
          label: "Close Tab",
          accelerator: "CmdOrCtrl+W",
          click: () => win.webContents.send(IPC.shortcuts.action, "closeTab"),
        },
        { type: "separator" },
        isMac ? { role: "close" as const } : { role: "quit" as const },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Appearance",
          click: () => win.webContents.send(IPC.shortcuts.action, "themes"),
        },
        { type: "separator" },
        {
          label: "Find",
          accelerator: "CmdOrCtrl+F",
          click: () => win.webContents.send(IPC.shortcuts.action, "search"),
        },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(process.env["ELECTRON_RENDERER_URL"]
          ? [{ role: "toggleDevTools" as const }]
          : []),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  // ── Keyboard shortcuts ──────────────────────────────────────────
  // Intercept before Electron's default menu so Cmd+W doesn't close the
  // window and Cmd+T doesn't open a Chromium tab. Instead we push a
  // named action to the renderer which handles it in React.
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const mod = process.platform === "darwin" ? input.meta : input.control;
    if (!mod) return;

    if (input.key === "t" && !input.shift && !input.alt) {
      event.preventDefault();
      win.webContents.send(IPC.shortcuts.action, "newTab");
    } else if (input.key === "w" && !input.shift && !input.alt) {
      event.preventDefault();
      win.webContents.send(IPC.shortcuts.action, "closeTab");
    } else if (input.key === "f" && !input.shift && !input.alt) {
      event.preventDefault();
      win.webContents.send(IPC.shortcuts.action, "search");
    } else if (input.key >= "1" && input.key <= "9" && !input.shift && !input.alt) {
      event.preventDefault();
      win.webContents.send(IPC.shortcuts.action, `switchTab:${input.key}`);
    }
  });

  registerPtyHandlers(win, repo);
  return win;
}

// ── Lifecycle ──────────────────────────────────────────────────────

app.whenReady().then(() => {
  // DB + repo come up before any window so handlers are ready when the
  // renderer fires its first list call.
  const db = getDb();
  const repo = createRepo(db);
  seedIfEmpty(repo);
  seedServersyncOnce(repo);
  registerProjectHandlers(repo);
  registerSessionHandlers(repo);
  registerSettingsHandlers(repo);
  registerTranscriptHandlers(repo);
  registerSearchHandlers(repo);
  registerDialogHandlers();

  // Lightweight system info — returns total RSS in bytes.
  ipcMain.handle(IPC.system.memoryUsage, async () => {
    const metrics = app.getAppMetrics();
    return metrics.reduce((sum, m) => sum + m.memory.workingSetSize * 1024, 0);
  });

  ipcMain.handle(IPC.system.toggleFullscreen, async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return false;
    win.setFullScreen(!win.isFullScreen());
    return win.isFullScreen();
  });

  ipcMain.handle(IPC.system.isFullscreen, async () => {
    const win = BrowserWindow.getFocusedWindow();
    return win?.isFullScreen() ?? false;
  });

  createWindow(repo);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(repo);
  });
});

app.on("window-all-closed", () => {
  // Flush and close all transcript writers before killing connections.
  for (const w of writers.values()) {
    try {
      w.close();
    } catch { /* noop */ }
  }
  writers.clear();

  // Tear down any leftover PTYs / SSH connections
  for (const conn of connections.values()) {
    try {
      conn.kill();
    } catch {
      /* noop */
    }
  }
  connections.clear();

  closeDb();

  if (process.platform !== "darwin") app.quit();
});
