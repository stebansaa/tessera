-- Remove persisted terminal transcripts and related search/run tables.
-- The terminal now keeps only live in-memory scrollback.

DROP TRIGGER IF EXISTS transcript_chunks_ai;
DROP TRIGGER IF EXISTS transcript_chunks_ad;
DROP TABLE IF EXISTS transcript_fts;
DROP INDEX IF EXISTS idx_chunks_session_seq;
DROP TABLE IF EXISTS transcript_chunks;
DROP INDEX IF EXISTS idx_runs_session;
DROP TABLE IF EXISTS session_runs;
