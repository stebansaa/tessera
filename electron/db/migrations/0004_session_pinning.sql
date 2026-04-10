-- Pin support: when set, this session should appear in the top-of-sidebar
-- PINNED section sorted by pinned_at DESC. NULL = not pinned. last_used_at
-- already exists from 0001 and is touched on every successful PTY spawn.
ALTER TABLE sessions ADD COLUMN pinned_at INTEGER;
