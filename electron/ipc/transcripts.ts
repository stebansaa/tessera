import { ipcMain } from "electron";
import { IPC } from "../../src/shared/ipc";
import type { LoadTranscriptRequest } from "../../src/shared/ipc";
import type { Repo } from "../db/repo";

export function registerTranscriptHandlers(repo: Repo) {
  ipcMain.handle(
    IPC.transcripts.load,
    async (_evt, req: LoadTranscriptRequest) => repo.loadTranscript(req),
  );
}
