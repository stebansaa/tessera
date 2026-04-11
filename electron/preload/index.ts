import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";
import { IPC } from "../../src/shared/ipc";
import type {
  ConnectionStatusEvent,
  CreateProjectRequest,
  CreateSessionRequest,
  IdRequest,
  ReorderSessionRequest,
  LoadTranscriptRequest,
  LoadTranscriptResponse,
  OpenFileRequest,
  Project,
  PtyKillRequest,
  PtyResizeRequest,
  PtySpawnRequest,
  PtySpawnResponse,
  PtyWriteRequest,
  RenameRequest,
  RendererApi,
  SearchRequest,
  SearchResponse,
  Session,
  SessionDetails,
  StorageStats,
  TabsState,
  ThemeSettings,
  UpdateSessionInput,
} from "../../src/shared/ipc";

const api: RendererApi = {
  projects: {
    list: (): Promise<Project[]> => ipcRenderer.invoke(IPC.projects.list),
    create: (req: CreateProjectRequest): Promise<Project> =>
      ipcRenderer.invoke(IPC.projects.create, req),
    rename: (req: RenameRequest): Promise<void> =>
      ipcRenderer.invoke(IPC.projects.rename, req),
    delete: (req: IdRequest): Promise<void> =>
      ipcRenderer.invoke(IPC.projects.delete, req),
  },

  sessions: {
    list: (): Promise<Session[]> => ipcRenderer.invoke(IPC.sessions.list),
    create: (req: CreateSessionRequest): Promise<Session> =>
      ipcRenderer.invoke(IPC.sessions.create, req),
    getDetails: (req: IdRequest): Promise<SessionDetails | null> =>
      ipcRenderer.invoke(IPC.sessions.getDetails, req),
    update: (req: UpdateSessionInput): Promise<void> =>
      ipcRenderer.invoke(IPC.sessions.update, req),
    delete: (req: IdRequest): Promise<void> =>
      ipcRenderer.invoke(IPC.sessions.delete, req),
    pin: (req: IdRequest): Promise<void> =>
      ipcRenderer.invoke(IPC.sessions.pin, req),
    unpin: (req: IdRequest): Promise<void> =>
      ipcRenderer.invoke(IPC.sessions.unpin, req),
    reorder: (req: ReorderSessionRequest): Promise<void> =>
      ipcRenderer.invoke(IPC.sessions.reorder, req),
  },

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

    onConnStatus: (handler: (evt: ConnectionStatusEvent) => void) => {
      const listener = (_evt: IpcRendererEvent, data: ConnectionStatusEvent) =>
        handler(data);
      ipcRenderer.on(IPC.pty.connStatus, listener);
      return () => ipcRenderer.removeListener(IPC.pty.connStatus, listener);
    },

    getConnStatusSnapshot: (): Promise<Record<string, number>> =>
      ipcRenderer.invoke(IPC.pty.connStatusSnapshot),
  },

  transcripts: {
    load: (req: LoadTranscriptRequest): Promise<LoadTranscriptResponse> =>
      ipcRenderer.invoke(IPC.transcripts.load, req),
    clear: (req: IdRequest): Promise<void> =>
      ipcRenderer.invoke(IPC.transcripts.clear, req),
    storageStats: (): Promise<StorageStats> =>
      ipcRenderer.invoke(IPC.transcripts.storageStats),
  },

  settings: {
    getTheme: (): Promise<ThemeSettings> =>
      ipcRenderer.invoke(IPC.settings.getTheme),
    setTheme: (theme: ThemeSettings): Promise<void> =>
      ipcRenderer.invoke(IPC.settings.setTheme, theme),
    getTabs: (): Promise<TabsState> =>
      ipcRenderer.invoke(IPC.settings.getTabs),
    setTabs: (state: TabsState): Promise<void> =>
      ipcRenderer.invoke(IPC.settings.setTabs, state),
    getLastSession: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC.settings.getLastSession),
    setLastSession: (id: string): Promise<void> =>
      ipcRenderer.invoke(IPC.settings.setLastSession, id),
  },

  search: {
    fts: (req: SearchRequest): Promise<SearchResponse> =>
      ipcRenderer.invoke(IPC.search.fts, req),
  },

  system: {
    memoryUsage: (): Promise<number> =>
      ipcRenderer.invoke(IPC.system.memoryUsage),
    toggleFullscreen: (): Promise<boolean> =>
      ipcRenderer.invoke(IPC.system.toggleFullscreen),
    isFullscreen: (): Promise<boolean> =>
      ipcRenderer.invoke(IPC.system.isFullscreen),
  },

  dialog: {
    openFile: (req?: OpenFileRequest): Promise<string | null> =>
      ipcRenderer.invoke(IPC.dialog.openFile, req),
  },

  shortcuts: {
    onAction: (handler: (action: string) => void) => {
      const listener = (_evt: IpcRendererEvent, action: string) =>
        handler(action);
      ipcRenderer.on(IPC.shortcuts.action, listener);
      return () => ipcRenderer.removeListener(IPC.shortcuts.action, listener);
    },
  },
};

contextBridge.exposeInMainWorld("api", api);
