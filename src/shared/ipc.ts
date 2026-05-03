/**
 * Typed IPC contract — shared by main process and renderer.
 *
 * Naming convention: `domain:action`
 *
 * Add new channels here BEFORE wiring them on either side. Both processes
 * import from this file so the contract stays in sync.
 */

// ── Projects + Sessions ────────────────────────────────────────────

/**
 * Renderer-facing session kind.
 *
 * Maps onto the schema as:
 *   local | ssh  → sessions.type = 'terminal' (mode in terminal_sessions)
 *   llm          → sessions.type = 'llm'
 *   web          → sessions.type = 'webview'
 */
export type SessionKind = "local" | "ssh" | "llm" | "web";

export interface Project {
  id: string;
  name: string;
  position: number;
}

export interface Session {
  id: string;
  projectId: string;
  name: string;
  kind: SessionKind;
  position: number;
  /** Epoch ms — bumped every time the session is connected. Drives the
   *  RECENT section in the sidebar. */
  lastUsedAt: number;
  /** Epoch ms when the session was pinned, or null if not pinned. Drives
   *  the PINNED section in the sidebar (sorted DESC). */
  pinnedAt: number | null;
}

export interface CreateProjectRequest {
  name: string;
}

/**
 * SSH auth methods we support today:
 *   - 'password': prompt-style password (encrypted via Electron safeStorage)
 *   - 'key':      private key file at `identityFile`
 *
 * SSH agent forwarding was considered but cut: Windows ships three
 * incompatible agents (OpenSSH service, Pageant, WSL) and none are on by
 * default, so it's an "advanced users only" feature that bloats the form
 * for the 95% case. Stored as a string in `terminal_sessions.auth_method`;
 * `null` means the session is local (or the user hasn't picked yet).
 */
export type SshAuthMethod = "password" | "key";

/**
 * Terminal extras returned to the renderer. This is read-only — the
 * `password` cleartext never crosses the IPC boundary, only a boolean
 * flag indicating whether one is currently stored. Use TerminalDetailsInput
 * for create/update calls that need to write a password.
 */
export interface TerminalDetails {
  shellPath: string | null;
  startDir: string | null;
  host: string | null;
  username: string | null;
  port: number | null;
  authMethod: SshAuthMethod | null;
  identityFile: string | null;
  /** SSH only. Optimistically local-echoes safe printable input to hide latency. */
  sshOptimisticEcho: boolean;
  /** Terminal sessions only. When true, a validated OpenRouter key auto-starts the side brief. */
  liveBriefEnabled: boolean;
  /** True if `password_enc` is set in the DB. */
  hasPassword: boolean;
}

/**
 * Write-side shape: what the renderer is allowed to *send* to create or
 * update a terminal session. The cleartext `password` only lives here on
 * the way in — main encrypts it via safeStorage and stores the bytes in
 * `terminal_sessions.password_enc`. Sending `password: null` clears the
 * stored password; omitting it (`undefined`) leaves the existing one alone.
 */
export interface TerminalDetailsInput {
  shellPath?: string | null;
  startDir?: string | null;
  host?: string | null;
  username?: string | null;
  port?: number | null;
  authMethod?: SshAuthMethod | null;
  identityFile?: string | null;
  sshOptimisticEcho?: boolean | null;
  liveBriefEnabled?: boolean | null;
  password?: string | null;
}

/** Full session record incl. the type-specific extension row. */
export interface SessionDetails extends Session {
  terminal: TerminalDetails | null;
}

export interface CreateSessionRequest {
  projectId?: string;
  name: string;
  kind: SessionKind;
  // Terminal extras (only used when kind is local|ssh)
  shellPath?: string | null;
  startDir?: string | null;
  host?: string | null;
  username?: string | null;
  port?: number | null;
  // SSH auth (only used when kind is ssh)
  authMethod?: SshAuthMethod | null;
  identityFile?: string | null;
  sshOptimisticEcho?: boolean | null;
  liveBriefEnabled?: boolean | null;
  /** Cleartext on the way in only — see TerminalDetailsInput. */
  password?: string | null;
}

export interface UpdateSessionInput {
  id: string;
  projectId?: string;
  name: string;
  // Provide for terminal sessions only.
  terminal?: TerminalDetailsInput | null;
}

export interface RenameRequest {
  id: string;
  name: string;
}

export interface IdRequest {
  id: string;
}

export interface ReorderSessionRequest {
  id: string;
  /** "up" moves toward lower position (higher in the list), "down" the opposite. */
  direction: "up" | "down";
}

// ── App settings ───────────────────────────────────────────────────

/**
 * App-wide preferences. Persisted as a single JSON-ish blob in the
 * `app_settings` table under key `theme`. Adding fields here is fine —
 * defaults are merged on read so older saved values keep working.
 */
export interface ThemeSettings {
  /** Hex color (#rrggbb) used as the UI accent everywhere. */
  accentColor: string;
  /** Terminal font family. Also used for the rest of the monospace UI. */
  fontFamily: string;
  /** Terminal font size in pixels. */
  fontSize: number;
  /** Key into COLOR_SCHEMES — drives all UI and terminal colors. */
  colorScheme: string;
}

export const DEFAULT_THEME: ThemeSettings = {
  accentColor: "#5fb3fa",
  fontFamily: "JetBrains Mono",
  fontSize: 13,
  colorScheme: "dark",
};

/**
 * Persisted UI state for the tab bar. We store the per-session tab list
 * and the active tab pointer so the user reopens the app right where
 * they left off. PTYs themselves don't survive a relaunch in Phase 1 —
 * each tab spawns a fresh shell on next mount.
 */
export type TabType = "terminal" | "webview";

export interface TabRecord {
  id: string;
  /** Stored as just the index/number; the UI prefixes the project name. */
  name: string;
  /** Defaults to "terminal" for backwards compat with older persisted state. */
  type?: TabType;
  /** URL for webview tabs. */
  url?: string;
}

export interface TabsState {
  tabsBySession: Record<string, TabRecord[]>;
  activeTabBySession: Record<string, string>;
}

export const EMPTY_TABS_STATE: TabsState = {
  tabsBySession: {},
  activeTabBySession: {},
};

// ── PTY (Phase 1) ──────────────────────────────────────────────────

export interface PtySpawnRequest {
  /**
   * Optional session id. When set, main looks up the session in SQLite and
   * routes the spawn through the appropriate backend:
   *   - terminal/local → node-pty
   *   - terminal/ssh   → ssh2 client + shell channel
   * When omitted, main falls back to a plain local PTY using the fields
   * below — useful for ad-hoc tabs that aren't bound to a session.
   */
  sessionId?: string;
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

/** Pushed from main whenever a session's live connection count changes. */
export interface ConnectionStatusEvent {
  sessionId: string;
  /** Number of live ptyIds for this session. 0 = fully disconnected. */
  liveCount: number;
}

// ── Live brief / OpenRouter ────────────────────────────────────────

export interface BriefTerminalEvent {
  ts: number;
  sessionId: string;
  tabId: string;
  stream: "input" | "output" | "system";
  text: string;
}

export interface BriefSummary {
  now: string;
  recent: string[];
  issues: string[];
  next: string[];
  contextFile?: string | null;
  updatedAt: number;
}

export interface BriefSettings {
  hasApiKey: boolean;
  hasValidApiKey: boolean;
  keyLabel: string | null;
  model: string;
}

export interface SetBriefApiKeyRequest {
  apiKey: string | null;
}

export interface ValidateBriefApiKeyRequest {
  apiKey?: string | null;
}

export interface SummarizeBriefRequest {
  sessionId: string;
  sessionName: string;
  model?: string;
  previousSummary?: BriefSummary | null;
  events: BriefTerminalEvent[];
}

export interface SummarizeBriefResponse {
  summary: BriefSummary;
}

// ── Channel names ──────────────────────────────────────────────────

export const IPC = {
  projects: {
    list: "projects:list",
    create: "projects:create",
    rename: "projects:rename",
    delete: "projects:delete",
  },
  sessions: {
    list: "sessions:list",
    create: "sessions:create",
    getDetails: "sessions:getDetails",
    update: "sessions:update",
    delete: "sessions:delete",
    pin: "sessions:pin",
    unpin: "sessions:unpin",
    reorder: "sessions:reorder",
  },
  pty: {
    spawn: "pty:spawn",
    write: "pty:write",
    resize: "pty:resize",
    kill: "pty:kill",
    // events (main → renderer): suffixed with ptyId
    dataPrefix: "pty:data:",
    exitPrefix: "pty:exit:",
    // connection status (main → renderer push, plus snapshot request)
    connStatus: "pty:connStatus",
    connStatusSnapshot: "pty:connStatusSnapshot",
  },
  system: {
    memoryUsage: "system:memoryUsage",
    toggleFullscreen: "system:toggleFullscreen",
    isFullscreen: "system:isFullscreen",
  },
  shortcuts: {
    /** Main → renderer push when a keyboard shortcut fires. */
    action: "shortcut:action",
  },
  settings: {
    getTheme: "settings:getTheme",
    setTheme: "settings:setTheme",
    getTabs: "settings:getTabs",
    setTabs: "settings:setTabs",
    getLastSession: "settings:getLastSession",
    setLastSession: "settings:setLastSession",
  },
  brief: {
    getSettings: "brief:getSettings",
    setApiKey: "brief:setApiKey",
    validateApiKey: "brief:validateApiKey",
    summarize: "brief:summarize",
  },
  dialog: {
    openFile: "dialog:openFile",
  },
} as const;

/**
 * Native file picker request. Optional title + extensions; both default
 * to "any file" so the SSH key picker can pick keys with no extension.
 */
export interface OpenFileRequest {
  title?: string;
  extensions?: string[];
}

// ── Renderer-side API surface (exposed by preload via contextBridge) ──
// `window.api` will conform to this type.

export interface RendererApi {
  projects: {
    list: () => Promise<Project[]>;
    create: (req: CreateProjectRequest) => Promise<Project>;
    rename: (req: RenameRequest) => Promise<void>;
    delete: (req: IdRequest) => Promise<void>;
  };
  sessions: {
    list: () => Promise<Session[]>;
    create: (req: CreateSessionRequest) => Promise<Session>;
    getDetails: (req: IdRequest) => Promise<SessionDetails | null>;
    update: (req: UpdateSessionInput) => Promise<void>;
    delete: (req: IdRequest) => Promise<void>;
    pin: (req: IdRequest) => Promise<void>;
    unpin: (req: IdRequest) => Promise<void>;
    reorder: (req: ReorderSessionRequest) => Promise<void>;
  };
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
    onConnStatus: (
      handler: (evt: ConnectionStatusEvent) => void,
    ) => () => void;
    getConnStatusSnapshot: () => Promise<Record<string, number>>;
  };
  settings: {
    getTheme: () => Promise<ThemeSettings>;
    setTheme: (theme: ThemeSettings) => Promise<void>;
    getTabs: () => Promise<TabsState>;
    setTabs: (state: TabsState) => Promise<void>;
    getLastSession: () => Promise<string | null>;
    setLastSession: (id: string) => Promise<void>;
  };
  brief: {
    getSettings: () => Promise<BriefSettings>;
    setApiKey: (req: SetBriefApiKeyRequest) => Promise<BriefSettings>;
    validateApiKey: (req?: ValidateBriefApiKeyRequest) => Promise<BriefSettings>;
    summarize: (req: SummarizeBriefRequest) => Promise<SummarizeBriefResponse>;
  };
  system: {
    /** Returns total RSS of the Electron app in bytes. */
    memoryUsage: () => Promise<number>;
    toggleFullscreen: () => Promise<boolean>;
    isFullscreen: () => Promise<boolean>;
  };
  dialog: {
    openFile: (req?: OpenFileRequest) => Promise<string | null>;
  };
  shortcuts: {
    onAction: (handler: (action: string) => void) => () => void;
  };
}

declare global {
  interface Window {
    api: RendererApi;
  }
}
