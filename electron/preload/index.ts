import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";
import { IPC } from "../../src/shared/ipc";
import type {
  PtySpawnRequest,
  PtySpawnResponse,
  PtyWriteRequest,
  PtyResizeRequest,
  PtyKillRequest,
  RendererApi,
} from "../../src/shared/ipc";

const api: RendererApi = {
  pty: {
    spawn: (req: PtySpawnRequest): Promise<PtySpawnResponse> =>
      ipcRenderer.invoke(IPC.pty.spawn, req),

    write: (req: PtyWriteRequest): Promise<void> =>
      ipcRenderer.invoke(IPC.pty.write, req),

    resize: (req: PtyResizeRequest): Promise<void> =>
      ipcRenderer.invoke(IPC.pty.resize, req),

    kill: (req: PtyKillRequest): Promise<void> =>
      ipcRenderer.invoke(IPC.pty.kill, req),

    onData: (ptyId: string, handler: (data: string) => void) => {
      const channel = `${IPC.pty.dataPrefix}${ptyId}`;
      const listener = (_evt: IpcRendererEvent, data: string) => handler(data);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },

    onExit: (ptyId, handler) => {
      const channel = `${IPC.pty.exitPrefix}${ptyId}`;
      const listener = (
        _evt: IpcRendererEvent,
        info: { exitCode: number; signal?: number },
      ) => handler(info);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
  },
};

contextBridge.exposeInMainWorld("api", api);
