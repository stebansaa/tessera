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

CREATE TABLE session_runs (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  tab_name    TEXT,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  status      TEXT NOT NULL
);
CREATE INDEX idx_runs_session ON session_runs(session_id);

CREATE TABLE transcript_chunks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  run_id       TEXT REFERENCES session_runs(id) ON DELETE SET NULL,
  seq          INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  chunk_type   TEXT NOT NULL,
  content_text TEXT NOT NULL
);
CREATE INDEX idx_chunks_session_seq ON transcript_chunks(session_id, seq);

CREATE TABLE llm_messages (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  content     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_msgs_session ON llm_messages(session_id);

CREATE VIRTUAL TABLE transcript_fts USING fts5(
  content_text,
  content='transcript_chunks',
  content_rowid='id'
);

CREATE TRIGGER transcript_chunks_ai AFTER INSERT ON transcript_chunks BEGIN
  INSERT INTO transcript_fts(rowid, content_text) VALUES (new.id, new.content_text);
END;

CREATE TRIGGER transcript_chunks_ad AFTER DELETE ON transcript_chunks BEGIN
  INSERT INTO transcript_fts(transcript_fts, rowid, content_text)
  VALUES('delete', old.id, old.content_text);
END;
