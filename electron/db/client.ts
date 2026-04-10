import Database from "better-sqlite3";
import { app } from "electron";
import { join } from "path";
import { runMigrations } from "./migrate";

let db: Database.Database | null = null;

/**
 * Open (or return) the singleton SQLite handle for Tessera.
 *
 * Lives in the OS-standard userData directory:
 *   - Linux:   ~/.config/tessera/tessera.db
 *   - macOS:   ~/Library/Application Support/tessera/tessera.db
 *   - Windows: %APPDATA%/tessera/tessera.db
 *
 * Runs all pending migrations on first call. Safe to call repeatedly.
 */
export function getDb(): Database.Database {
  if (db) return db;

  const file = join(app.getPath("userData"), "tessera.db");
  db = new Database(file);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  runMigrations(db);
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
