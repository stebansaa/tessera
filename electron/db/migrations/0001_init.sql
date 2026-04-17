-- Tessera initial schema (v1)
-- Forward-only migration. See electron/db/migrate.ts for the runner.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK(type IN ('terminal','llm','webview')),
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER NOT NULL
);
CREATE INDEX idx_sessions_project ON sessions(project_id);

CREATE TABLE terminal_sessions (
  session_id     TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  mode           TEXT NOT NULL CHECK(mode IN ('local','ssh')),
  shell_path     TEXT,
  start_dir      TEXT,
  host           TEXT,
  username       TEXT,
  port           INTEGER,
  auth_method    TEXT,
  identity_file  TEXT
);

CREATE TABLE llm_sessions (
  session_id     TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL,
  model          TEXT NOT NULL,
  system_prompt  TEXT
);

CREATE TABLE webview_sessions (
  session_id   TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  initial_url  TEXT NOT NULL,
  current_url  TEXT NOT NULL,
  title        TEXT
);

CREATE TABLE llm_messages (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  content     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_msgs_session ON llm_messages(session_id);
