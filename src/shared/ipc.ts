/**
 * Typed IPC contract — shared by main process and renderer.
 *
 * Naming convention: `domain:action`
 *
 * Add new channels here BEFORE wiring them on either side. Both processes
 * import from this file so the contract stays in sync.
 */

// ── PTY (Phase 1) ──────────────────────────────────────────────────

export interface PtySpawnRequest {
  shell?: string;        // defaults to user's $SHELL or /bin/bash
  cwd?: string;          // defaults to home dir
  cols: number;
  rows: number;
  env?: Record<string, string>;
}

export interface PtySpawnResponse {
  ptyId: string;
}

export interface PtyWriteRequest {
  ptyId: string;
  data: string;
}

export interface PtyResizeRequest {
  ptyId: string;
  cols: number;
  rows: number;
}

export interface PtyKillRequest {
  ptyId: string;
}

// ── Channel names ──────────────────────────────────────────────────

export const IPC = {
  pty: {
    spawn: "pty:spawn",
    write: "pty:write",
    resize: "pty:resize",
    kill: "pty:kill",
    // events (main → renderer): suffixed with ptyId
    dataPrefix: "pty:data:",
    exitPrefix: "pty:exit:",
  },
} as const;

// ── Renderer-side API surface (exposed by preload via contextBridge) ──
// `window.api` will conform to this type.

export interface RendererApi {
  pty: {
    spawn: (req: PtySpawnRequest) => Promise<PtySpawnResponse>;
    write: (req: PtyWriteRequest) => Promise<void>;
    resize: (req: PtyResizeRequest) => Promise<void>;
    kill: (req: PtyKillRequest) => Promise<void>;
    onData: (ptyId: string, handler: (data: string) => void) => () => void;
    onExit: (
      ptyId: string,
      handler: (info: { exitCode: number; signal?: number }) => void,
    ) => () => void;
  };
}

declare global {
  interface Window {
    api: RendererApi;
  }
}
