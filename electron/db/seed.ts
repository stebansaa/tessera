import type { Repo } from "./repo";

/**
 * On first launch (empty `projects` table) seed a single demo project so the
 * sidebar isn't blank. Once the user creates real data we never run this
 * again.
 */
export function seedIfEmpty(repo: Repo) {
  if (!repo.isEmpty()) return;

  const infra = repo.createProject("INFRA");
  repo.createSession({ projectId: infra.id, name: "prod-server", kind: "ssh" });
  repo.createSession({ projectId: infra.id, name: "staging-db", kind: "ssh" });
  repo.createSession({ projectId: infra.id, name: "local dev", kind: "local" });

  console.log("[db] seeded first-run demo data");
}

/**
 * Dev convenience: seed a real serversync SSH session pre-filled with the
 * connection details from `~/serversync/sync-2026.sh`, so the developer can
 * test the SSH path against an actual server without retyping the form.
 *
 * Idempotent via a marker in `app_settings` — runs exactly once. If the
 * user later deletes the session it will NOT come back, because the marker
 * stays set. To force a re-seed, clear `seed:serversync` from app_settings.
 */
const SERVERSYNC_SEED_KEY = "seed:serversync";

export function seedServersyncOnce(repo: Repo) {
  if (repo.getSetting(SERVERSYNC_SEED_KEY)) return;

  // Drop it into the first project we find, or create an INFRA project
  // if the DB has none yet (shouldn't happen because seedIfEmpty runs
  // first, but stays robust if a future change reorders things).
  const projects = repo.listProjects();
  const projectId =
    projects[0]?.id ?? repo.createProject("INFRA").id;

  repo.createSession({
    projectId,
    name: "serversync",
    kind: "ssh",
    host: "69.57.160.243",
    username: "root",
    port: 22,
    authMethod: "key",
    // Stored with a leading `~`; main expands it to $HOME at connect time.
    identityFile: "~/.ssh/serversync_key",
  });

  repo.setSetting(SERVERSYNC_SEED_KEY, String(Date.now()));
  console.log("[db] seeded serversync test session");
}
