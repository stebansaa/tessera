-- App-level key/value settings (themes, font preferences, etc.).
-- Kept as a tiny key/value table so future settings can land without
-- another migration.

CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
