import type { Repo } from "../db/repo";

/**
 * Buffers PTY output and batch-inserts transcript chunks to SQLite.
 *
 * One writer per live PTY. Flushes on a timer (200ms) or when the
 * buffer exceeds a size threshold (8KB), whichever comes first.
 * Also flushes on explicit `close()` so the last bytes aren't lost.
 */
const FLUSH_INTERVAL_MS = 200;
const FLUSH_SIZE_BYTES = 8 * 1024;

export class TranscriptWriter {
  private buffer = "";
  private timer: ReturnType<typeof setInterval> | null = null;
  private seq: number;
  private closed = false;

  constructor(
    private repo: Repo,
    private sessionId: string,
    /** Exposed so the exit handler can call repo.endRun(). */
    public readonly runId: string,
    startSeq: number,
  ) {
    this.seq = startSeq;
    this.timer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  /** Append PTY data to the buffer. May trigger an immediate flush. */
  write(data: string): void {
    if (this.closed) return;
    this.buffer += data;
    if (this.buffer.length >= FLUSH_SIZE_BYTES) {
      this.flush();
    }
  }

  /** Write a connection-event marker (connect/disconnect divider). */
  writeEvent(contentText: string): void {
    if (this.closed) return;
    this.flush(); // ensure pending output is written first
    this.repo.appendChunk(
      this.sessionId,
      this.runId,
      this.seq++,
      "event",
      contentText,
    );
  }

  /** Flush buffered output to SQLite. */
  flush(): void {
    if (this.buffer.length === 0) return;
    this.repo.appendChunk(
      this.sessionId,
      this.runId,
      this.seq++,
      "output",
      this.buffer,
    );
    this.buffer = "";
  }

  /** Flush and stop the timer. Call on PTY exit or kill. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush();
  }
}
