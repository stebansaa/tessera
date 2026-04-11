import type { Repo } from "./repo";

/**
 * On first launch (empty `projects` table) seed a single default project
 * so the sidebar has a home for new connections. No demo sessions are
 * created — the user starts with a clean workspace.
 */
export function seedIfEmpty(repo: Repo) {
  if (!repo.isEmpty()) return;

  repo.createProject("Default");
  console.log("[db] seeded default project");
}
