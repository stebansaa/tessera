import { ipcMain } from "electron";
import { IPC } from "../../src/shared/ipc";
import type {
  CreateSessionRequest,
  IdRequest,
  ReorderSessionRequest,
  UpdateSessionInput,
} from "../../src/shared/ipc";
import type { Repo } from "../db/repo";

export function registerSessionHandlers(repo: Repo) {
  ipcMain.handle(IPC.sessions.list, async () => repo.listSessions());

  ipcMain.handle(
    IPC.sessions.create,
    async (_evt, req: CreateSessionRequest) => repo.createSession(req),
  );

  ipcMain.handle(IPC.sessions.getDetails, async (_evt, req: IdRequest) =>
    repo.getSessionDetails(req.id),
  );

  ipcMain.handle(IPC.sessions.update, async (_evt, req: UpdateSessionInput) => {
    repo.updateSession(req);
  });

  ipcMain.handle(IPC.sessions.delete, async (_evt, req: IdRequest) => {
    repo.deleteSession(req.id);
  });

  ipcMain.handle(IPC.sessions.pin, async (_evt, req: IdRequest) => {
    repo.pinSession(req.id);
  });

  ipcMain.handle(IPC.sessions.unpin, async (_evt, req: IdRequest) => {
    repo.unpinSession(req.id);
  });

  ipcMain.handle(
    IPC.sessions.reorder,
    async (_evt, req: ReorderSessionRequest) => {
      repo.reorderSession(req.id, req.direction);
    },
  );
}
