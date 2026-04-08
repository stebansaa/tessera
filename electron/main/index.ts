import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "path";
import { randomUUID } from "crypto";
import { spawn as ptySpawn, IPty } from "node-pty";
import { IPC } from "../../src/shared/ipc";
import type {
  PtySpawnRequest,
  PtySpawnResponse,
  PtyWriteRequest,
  PtyResizeRequest,
  PtyKillRequest,
} from "../../src/shared/ipc";

// ── PTY pool ───────────────────────────────────────────────────────

const ptys = new Map<string, IPty>();

function registerPtyHandlers(win: BrowserWindow) {
  ipcMain.handle(
    IPC.pty.spawn,
    async (_evt, req: PtySpawnRequest): Promise<PtySpawnResponse> => {
      const shellPath =
        req.shell ||
        process.env.SHELL ||
        (process.platform === "win32" ? "powershell.exe" : "/bin/bash");
      const cwd = req.cwd || app.getPath("home");

      const pty = ptySpawn(shellPath, [], {
        name: "xterm-256color",
        cols: req.cols,
        rows: req.rows,
        cwd,
        env: { ...process.env, ...(req.env ?? {}) } as Record<string, string>,
      });

      const ptyId = randomUUID();
      ptys.set(ptyId, pty);

      pty.onData((data) => {
        if (!win.isDestroyed()) {
          win.webContents.send(`${IPC.pty.dataPrefix}${ptyId}`, data);
        }
      });

      pty.onExit(({ exitCode, signal }) => {
        if (!win.isDestroyed()) {
          win.webContents.send(`${IPC.pty.exitPrefix}${ptyId}`, {
            exitCode,
            signal,
          });
        }
        ptys.delete(ptyId);
      });

      return { ptyId };
    },
  );

  ipcMain.handle(IPC.pty.write, async (_evt, req: PtyWriteRequest) => {
    ptys.get(req.ptyId)?.write(req.data);
  });

  ipcMain.handle(IPC.pty.resize, async (_evt, req: PtyResizeRequest) => {
    ptys.get(req.ptyId)?.resize(req.cols, req.rows);
  });

  ipcMain.handle(IPC.pty.kill, async (_evt, req: PtyKillRequest) => {
    ptys.get(req.ptyId)?.kill();
    ptys.delete(req.ptyId);
  });
}

// ── Window ─────────────────────────────────────────────────────────

function createWindow() {
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

  registerPtyHandlers(win);
  return win;
}

// ── Lifecycle ──────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // Tear down any leftover PTYs
  for (const pty of ptys.values()) {
    try {
      pty.kill();
    } catch {
      /* noop */
    }
  }
  ptys.clear();

  if (process.platform !== "darwin") app.quit();
});
