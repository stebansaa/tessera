-- Optional per-terminal-session AI brief. The side panel is hidden unless
-- this is enabled and the app has a validated OpenRouter API key.
ALTER TABLE terminal_sessions
  ADD COLUMN live_brief_enabled INTEGER NOT NULL DEFAULT 0;
