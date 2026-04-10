import { ipcMain } from "electron";
import { IPC } from "../../src/shared/ipc";
import type { SearchRequest, SearchResponse } from "../../src/shared/ipc";
import type { Repo } from "../db/repo";

export function registerSearchHandlers(repo: Repo) {
  ipcMain.handle(
    IPC.search.fts,
    async (_evt, req: SearchRequest): Promise<SearchResponse> => {
      const results = repo.searchTranscripts(
        req.query,
        req.sessionId,
        req.limit,
      );
      return { results };
    },
  );
}
