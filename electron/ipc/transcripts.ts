import { ipcMain } from "electron";
import { IPC } from "../../src/shared/ipc";
import type { IdRequest, LoadTranscriptRequest } from "../../src/shared/ipc";
import type { Repo } from "../db/repo";

export function registerTranscriptHandlers(repo: Repo) {
  ipcMain.handle(
    IPC.transcripts.load,
    async (_evt, req: LoadTranscriptRequest) => repo.loadTranscript(req),
  );

  ipcMain.handle(
    IPC.transcripts.clear,
    async (_evt, req: IdRequest) => {
      repo.clearTranscript(req.id);
    },
  );

  ipcMain.handle(IPC.transcripts.storageStats, async () =>
    repo.getStorageStats(),
  );
}
