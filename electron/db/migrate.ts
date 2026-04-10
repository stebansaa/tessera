import type Database from "better-sqlite3";

/**
 * Forward-only migration runner.
 *
 * Migration SQL files live in `electron/db/migrations/NNNN_name.sql`. They're
 * pulled in at build time via `import.meta.glob` so they end up bundled in the
 * main process — no fs reads at runtime, no path-resolution headaches between
 * `electron-vite dev` and packaged builds.
 *
 * The runner records applied versions in `schema_migrations` and only runs
 * files whose version hasn't been seen yet, in order. Each migration runs in a
 * transaction so a partial failure rolls back cleanly.
 */
const migrationModules = import.meta.glob("./migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

interface Migration {
  version: number;
  name: string;
  sql: string;
}

function loadMigrations(): Migration[] {
  const out: Migration[] = [];
  for (const [path, sql] of Object.entries(migrationModules)) {
    const file = path.split("/").pop() ?? "";
    const match = file.match(/^(\d+)_(.+)\.sql$/);
    if (!match) continue;
    out.push({
      version: parseInt(match[1], 10),
      name: match[2],
      sql,
    });
  }
  return out.sort((a, b) => a.version - b.version);
}

export function runMigrations(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const applied = new Set(
    db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((r: any) => r.version as number),
  );

  const insertMigration = db.prepare(
    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
  );

  for (const { version, name, sql } of loadMigrations()) {
    if (applied.has(version)) continue;

    const apply = db.transaction(() => {
      db.exec(sql);
      insertMigration.run(version, name, Date.now());
    });
    apply();

    console.log(`[db] applied migration ${version}_${name}`);
  }
}
