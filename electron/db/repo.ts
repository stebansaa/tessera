import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { safeStorage } from "electron";
import type {
  Project,
  Session,
  SessionDetails,
  SessionKind,
  SshAuthMethod,
  TabsState,
  TerminalDetails,
  TerminalDetailsInput,
  ThemeSettings,
  UpdateSessionInput,
} from "../../src/shared/ipc";
import { DEFAULT_THEME, EMPTY_TABS_STATE } from "../../src/shared/ipc";

/**
 * Encrypt a cleartext SSH password using Electron safeStorage. Returns
 * `null` if encryption isn't available on this OS / desktop session — we
 * surface that as "no password stored" rather than crashing, so the user
 * can still save the rest of the session and pick a different auth method
 * (key/agent) or fix their keychain. Cleartext is never written to disk.
 */
function encryptPassword(plain: string | null | undefined): Buffer | null {
  if (!plain) return null;
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn(
      "[repo] safeStorage unavailable — SSH password not stored. " +
        "Use key auth or unlock your OS keychain.",
    );
    return null;
  }
  return safeStorage.encryptString(plain);
}

/**
 * Projects + sessions repository.
 *
 * Wraps the prepared statements that touch `projects`, `sessions`, and the
 * type-specific extension tables. Returns plain DTOs that match the renderer's
 * shared IPC types — no SQL leaks past this module.
 */

function kindToType(kind: SessionKind): "terminal" | "llm" | "webview" {
  switch (kind) {
    case "local":
    case "ssh":
      return "terminal";
    case "llm":
      return "llm";
    case "web":
      return "webview";
  }
}

interface SessionRow {
  id: string;
  project_id: string;
  name: string;
  type: "terminal" | "llm" | "webview";
  position: number;
  mode: "local" | "ssh" | null;
  last_used_at: number;
  pinned_at: number | null;
}

function rowToSession(row: SessionRow): Session {
  let kind: SessionKind;
  if (row.type === "terminal") {
    kind = row.mode === "ssh" ? "ssh" : "local";
  } else if (row.type === "llm") {
    kind = "llm";
  } else {
    kind = "web";
  }
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    kind,
    position: row.position,
    lastUsedAt: row.last_used_at,
    pinnedAt: row.pinned_at,
  };
}

export interface CreateSessionInput {
  projectId: string;
  name: string;
  kind: SessionKind;
  // Terminal-specific (used when kind is local|ssh)
  shellPath?: string | null;
  startDir?: string | null;
  // SSH-only
  host?: string | null;
  username?: string | null;
  port?: number | null;
  authMethod?: SshAuthMethod | null;
  identityFile?: string | null;
  /** Cleartext on the way in only — encrypted before write. */
  password?: string | null;
}

export function createRepo(db: Database.Database) {
  const stmts = {
    listProjects: db.prepare(`
      SELECT id, name, position
      FROM projects
      ORDER BY position ASC, created_at ASC
    `),
    listSessions: db.prepare(`
      SELECT s.id, s.project_id, s.name, s.type, s.position, t.mode,
             s.last_used_at, s.pinned_at
      FROM sessions s
      LEFT JOIN terminal_sessions t ON t.session_id = s.id
      ORDER BY s.project_id, s.position ASC, s.created_at ASC
    `),
    countProjects: db.prepare(`SELECT COUNT(*) AS c FROM projects`),
    nextProjectPosition: db.prepare(`
      SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM projects
    `),
    nextSessionPosition: db.prepare(`
      SELECT COALESCE(MAX(position), -1) + 1 AS pos
      FROM sessions WHERE project_id = ?
    `),
    insertProject: db.prepare(`
      INSERT INTO projects (id, name, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `),
    insertSession: db.prepare(`
      INSERT INTO sessions
        (id, project_id, name, type, position, created_at, last_used_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    insertTerminal: db.prepare(`
      INSERT INTO terminal_sessions
        (session_id, mode, shell_path, start_dir, host, username, port,
         auth_method, identity_file, password_enc)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    insertLlm: db.prepare(`
      INSERT INTO llm_sessions (session_id, provider, model) VALUES (?, ?, ?)
    `),
    insertWebview: db.prepare(`
      INSERT INTO webview_sessions (session_id, initial_url, current_url)
      VALUES (?, ?, ?)
    `),
    renameProject: db.prepare(
      `UPDATE projects SET name = ?, updated_at = ? WHERE id = ?`,
    ),
    updateSessionRow: db.prepare(`
      UPDATE sessions SET name = ?, project_id = ? WHERE id = ?
    `),
    updateTerminal: db.prepare(`
      UPDATE terminal_sessions
      SET shell_path = ?, start_dir = ?, host = ?, username = ?, port = ?,
          auth_method = ?, identity_file = ?
      WHERE session_id = ?
    `),
    /** Separate statement so the password update is opt-in (omitting the
     *  field on update should leave the existing blob untouched). */
    updateTerminalPassword: db.prepare(`
      UPDATE terminal_sessions SET password_enc = ? WHERE session_id = ?
    `),
    selectSession: db.prepare(`
      SELECT s.id, s.project_id, s.name, s.type, s.position, t.mode,
             s.last_used_at, s.pinned_at
      FROM sessions s
      LEFT JOIN terminal_sessions t ON t.session_id = s.id
      WHERE s.id = ?
    `),
    selectTerminal: db.prepare(`
      SELECT shell_path, start_dir, host, username, port,
             auth_method, identity_file,
             (password_enc IS NOT NULL) AS has_password
      FROM terminal_sessions WHERE session_id = ?
    `),
    /** Main-process only — never expose this through IPC. */
    selectTerminalPasswordEnc: db.prepare(`
      SELECT password_enc FROM terminal_sessions WHERE session_id = ?
    `),
    deleteProject: db.prepare(`DELETE FROM projects WHERE id = ?`),
    deleteSession: db.prepare(`DELETE FROM sessions WHERE id = ?`),
    touchSession: db.prepare(
      `UPDATE sessions SET last_used_at = ? WHERE id = ?`,
    ),
    pinSession: db.prepare(
      `UPDATE sessions SET pinned_at = ? WHERE id = ?`,
    ),
    unpinSession: db.prepare(
      `UPDATE sessions SET pinned_at = NULL WHERE id = ?`,
    ),
    selectSessionPosition: db.prepare(
      `SELECT position, project_id FROM sessions WHERE id = ?`,
    ),
    updateSessionPosition: db.prepare(
      `UPDATE sessions SET position = ? WHERE id = ?`,
    ),
    getSetting: db.prepare(`SELECT value FROM app_settings WHERE key = ?`),
    upsertSetting: db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `),
  };

  const THEME_KEY = "theme";
  const TABS_KEY = "tabs";

  return {
    listProjects(): Project[] {
      return stmts.listProjects.all() as Project[];
    },

    listSessions(): Session[] {
      return (stmts.listSessions.all() as SessionRow[]).map(rowToSession);
    },

    createProject(name: string): Project {
      const id = randomUUID();
      const now = Date.now();
      const pos = (stmts.nextProjectPosition.get() as { pos: number }).pos;
      stmts.insertProject.run(id, name, pos, now, now);
      return { id, name, position: pos };
    },

    /** Returns the id of the first project, creating one if needed. */
    defaultProjectId(): string {
      const projects = stmts.listProjects.all() as { id: string }[];
      if (projects.length > 0) return projects[0].id;
      const id = randomUUID();
      const now = Date.now();
      stmts.insertProject.run(id, "Default", 0, now, now);
      return id;
    },

    createSession(input: CreateSessionInput): Session {
      const id = randomUUID();
      const now = Date.now();
      const type = kindToType(input.kind);
      const projectId = input.projectId ?? this.defaultProjectId();
      const pos = (
        stmts.nextSessionPosition.get(projectId) as { pos: number }
      ).pos;

      const tx = db.transaction(() => {
        stmts.insertSession.run(
          id,
          projectId,
          input.name,
          type,
          pos,
          now,
          now,
        );
        if (type === "terminal") {
          // Encrypt before the insert so the cleartext never exists past
          // this scope. The blob is `null` for non-password auth or when
          // safeStorage isn't available — see encryptPassword.
          const passwordEnc =
            input.kind === "ssh" && input.authMethod === "password"
              ? encryptPassword(input.password)
              : null;
          stmts.insertTerminal.run(
            id,
            input.kind === "ssh" ? "ssh" : "local",
            input.shellPath ?? null,
            input.startDir ?? null,
            input.host ?? null,
            input.username ?? null,
            input.port ?? null,
            input.kind === "ssh" ? (input.authMethod ?? null) : null,
            input.kind === "ssh" ? (input.identityFile ?? null) : null,
            passwordEnc,
          );
        } else if (type === "llm") {
          stmts.insertLlm.run(id, "openai", "gpt-4o-mini");
        } else {
          stmts.insertWebview.run(id, "about:blank", "about:blank");
        }
      });
      tx();

      return {
        id,
        projectId,
        name: input.name,
        kind: input.kind,
        position: pos,
        lastUsedAt: now,
        pinnedAt: null,
      };
    },

    getSessionDetails(id: string): SessionDetails | null {
      const row = stmts.selectSession.get(id) as SessionRow | undefined;
      if (!row) return null;
      const session = rowToSession(row);

      let terminal: TerminalDetails | null = null;
      if (row.type === "terminal") {
        const t = stmts.selectTerminal.get(id) as
          | {
              shell_path: string | null;
              start_dir: string | null;
              host: string | null;
              username: string | null;
              port: number | null;
              auth_method: SshAuthMethod | null;
              identity_file: string | null;
              has_password: number;
            }
          | undefined;
        if (t) {
          terminal = {
            shellPath: t.shell_path,
            startDir: t.start_dir,
            host: t.host,
            username: t.username,
            port: t.port,
            authMethod: t.auth_method,
            identityFile: t.identity_file,
            hasPassword: t.has_password === 1,
          };
        }
      }

      return { ...session, terminal };
    },

    updateSession(input: UpdateSessionInput): void {
      const tx = db.transaction(() => {
        const pid = input.projectId ?? this.defaultProjectId();
        stmts.updateSessionRow.run(input.name, pid, input.id);
        // We only let the form edit terminal extras for now. LLM/webview
        // editing comes alongside Phases 4/5.
        const t: TerminalDetailsInput | null | undefined = input.terminal;
        if (t) {
          stmts.updateTerminal.run(
            t.shellPath ?? null,
            t.startDir ?? null,
            t.host ?? null,
            t.username ?? null,
            t.port ?? null,
            t.authMethod ?? null,
            t.identityFile ?? null,
            input.id,
          );
          // Password is opt-in:
          //   - omitted (`undefined`) → leave the existing blob alone
          //   - explicit `null`        → clear the stored password
          //   - non-empty string       → encrypt and replace
          if (t.password !== undefined) {
            stmts.updateTerminalPassword.run(
              encryptPassword(t.password),
              input.id,
            );
          }
        }
      });
      tx();
    },

    renameProject(id: string, name: string): void {
      stmts.renameProject.run(name, Date.now(), id);
    },

    deleteProject(id: string): void {
      stmts.deleteProject.run(id);
    },

    deleteSession(id: string): void {
      stmts.deleteSession.run(id);
    },

    /** Bump last_used_at — called from main when a PTY successfully spawns
     *  for this session, so the RECENT section in the sidebar reflects it. */
    touchSession(id: string): void {
      stmts.touchSession.run(Date.now(), id);
    },

    pinSession(id: string): void {
      stmts.pinSession.run(Date.now(), id);
    },

    unpinSession(id: string): void {
      stmts.unpinSession.run(id);
    },

    /** Swap a session one position up or down within its project. */
    reorderSession(id: string, direction: "up" | "down"): void {
      const row = stmts.selectSessionPosition.get(id) as
        | { position: number; project_id: string }
        | undefined;
      if (!row) return;

      // Find the neighbor to swap with.
      const allSessions = (stmts.listSessions.all() as SessionRow[])
        .filter((s) => s.project_id === row.project_id)
        .sort((a, b) => a.position - b.position);

      const idx = allSessions.findIndex((s) => s.id === id);
      if (idx < 0) return;

      const neighborIdx = direction === "up" ? idx - 1 : idx + 1;
      if (neighborIdx < 0 || neighborIdx >= allSessions.length) return;

      const neighbor = allSessions[neighborIdx];
      const tx = db.transaction(() => {
        stmts.updateSessionPosition.run(neighbor.position, id);
        stmts.updateSessionPosition.run(row.position, neighbor.id);
      });
      tx();
    },

    isEmpty(): boolean {
      return (stmts.countProjects.get() as { c: number }).c === 0;
    },

    getTheme(): ThemeSettings {
      const row = stmts.getSetting.get(THEME_KEY) as
        | { value: string }
        | undefined;
      if (!row) return { ...DEFAULT_THEME };
      try {
        // Merge with defaults so newly added theme fields stay valid for
        // older saved blobs.
        return { ...DEFAULT_THEME, ...JSON.parse(row.value) };
      } catch {
        return { ...DEFAULT_THEME };
      }
    },

    setTheme(theme: ThemeSettings): void {
      stmts.upsertSetting.run(THEME_KEY, JSON.stringify(theme), Date.now());
    },

    getTabsState(): TabsState {
      const row = stmts.getSetting.get(TABS_KEY) as
        | { value: string }
        | undefined;
      if (!row) return { ...EMPTY_TABS_STATE };
      try {
        const parsed = JSON.parse(row.value) as Partial<TabsState>;
        return {
          tabsBySession: parsed.tabsBySession ?? {},
          activeTabBySession: parsed.activeTabBySession ?? {},
        };
      } catch {
        return { ...EMPTY_TABS_STATE };
      }
    },

    setTabsState(state: TabsState): void {
      stmts.upsertSetting.run(TABS_KEY, JSON.stringify(state), Date.now());
    },

    /** Generic key/value access on the app_settings table. Used by the
     *  one-shot seed hooks to record "this seed already ran" markers. */
    getSetting(key: string): string | null {
      const row = stmts.getSetting.get(key) as { value: string } | undefined;
      return row ? row.value : null;
    },
    setSetting(key: string, value: string): void {
      stmts.upsertSetting.run(key, value, Date.now());
    },

    /**
     * Decrypt and return the cleartext SSH password for a session, or
     * `null` if none is stored. Main-process only — must NEVER be exposed
     * over IPC. Used by the SSH spawn path to authenticate connections.
     */
    getSshPassword(sessionId: string): string | null {
      const row = stmts.selectTerminalPasswordEnc.get(sessionId) as
        | { password_enc: Buffer | null }
        | undefined;
      if (!row || !row.password_enc) return null;
      if (!safeStorage.isEncryptionAvailable()) {
        console.warn(
          "[repo] safeStorage unavailable — cannot decrypt SSH password",
        );
        return null;
      }
      try {
        return safeStorage.decryptString(row.password_enc);
      } catch (err) {
        console.error("[repo] failed to decrypt SSH password:", err);
        return null;
      }
    },
  };
}

export type Repo = ReturnType<typeof createRepo>;
