import { ipcMain } from "electron";
import { IPC } from "../../src/shared/ipc";
import type { TabsState, ThemeSettings } from "../../src/shared/ipc";
import type { Repo } from "../db/repo";

export function registerSettingsHandlers(repo: Repo) {
  ipcMain.handle(IPC.settings.getTheme, async () => repo.getTheme());

  ipcMain.handle(
    IPC.settings.setTheme,
    async (_evt, theme: ThemeSettings) => {
      repo.setTheme(theme);
    },
  );

  ipcMain.handle(IPC.settings.getTabs, async () => repo.getTabsState());

  ipcMain.handle(IPC.settings.setTabs, async (_evt, state: TabsState) => {
    repo.setTabsState(state);
  });
}
