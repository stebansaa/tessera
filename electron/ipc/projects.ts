import { ipcMain } from "electron";
import { IPC } from "../../src/shared/ipc";
import type {
  CreateProjectRequest,
  IdRequest,
  RenameRequest,
} from "../../src/shared/ipc";
import type { Repo } from "../db/repo";

export function registerProjectHandlers(repo: Repo) {
  ipcMain.handle(IPC.projects.list, async () => repo.listProjects());

  ipcMain.handle(
    IPC.projects.create,
    async (_evt, req: CreateProjectRequest) => repo.createProject(req.name),
  );

  ipcMain.handle(IPC.projects.rename, async (_evt, req: RenameRequest) => {
    repo.renameProject(req.id, req.name);
  });

  ipcMain.handle(IPC.projects.delete, async (_evt, req: IdRequest) => {
    repo.deleteProject(req.id);
  });
}
