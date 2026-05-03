-- Per-SSH-session latency hiding. This is enabled by default, but the
-- renderer uses conservative heuristics and only applies it to SSH terminals.
ALTER TABLE terminal_sessions
  ADD COLUMN ssh_optimistic_echo INTEGER NOT NULL DEFAULT 1;
