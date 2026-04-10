import { dialog, ipcMain } from "electron";
import { IPC } from "../../src/shared/ipc";
import type { OpenFileRequest } from "../../src/shared/ipc";

/**
 * Native file picker exposed to the renderer. Used today by the SSH form
 * to pick an identity (private key) file. Returns the selected absolute
 * path, or `null` if the user dismissed the dialog.
 */
export function registerDialogHandlers() {
  ipcMain.handle(
    IPC.dialog.openFile,
    async (_evt, req?: OpenFileRequest): Promise<string | null> => {
      const result = await dialog.showOpenDialog({
        properties: ["openFile"],
        title: req?.title ?? "Select file",
        // SSH keys often have no extension (e.g. ~/.ssh/id_ed25519), so
        // default to allowing anything.
        filters: req?.extensions?.length
          ? [{ name: "Files", extensions: req.extensions }]
          : [{ name: "All files", extensions: ["*"] }],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    },
  );
}
