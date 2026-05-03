# CLAUDE.md — Unified Workspace Terminal (Electron Edition)

This document is the spec for building a unified developer workspace terminal as an **Electron** application. It is self-contained: anyone reading it should be able to build the project from scratch with no other context.

---

## Product Vision

A local-first developer workspace that combines persistent terminal sessions (local + SSH), LLM chat sessions, and embedded webview panels — all organized into projects, with full local history stored in SQLite. Think *"ChatGPT Projects, but for servers, terminals, and AI."*

The product is for individual developers who currently juggle multiple terminal windows, SSH connections, browser tabs (for dashboards/docs), and chat windows (for LLM assistance). Instead of disposable tabs, every session is persistent, searchable, and reconnectable.

**Session types:**
- `terminal` — local shell (PTY) or SSH connection
- `llm` — chat session with an LLM (messages stored locally)
- `webview` — embedded web panel (docs, dashboards, consoles)

**Core data model:** Projects → Sessions → Runs (terminal) / Messages (LLM)

**Distribution:** one-time purchase (~$39–$79), no subscription, no cloud requirement, no telemetry by default. Local-first is a core product value.

---

## Why This Stack

We arrived at **Electron + React + xterm.js + node-pty + better-sqlite3** after evaluating two alternatives:

1. **WezTerm fork (Rust + custom GPU box model)** — beautiful terminal rendering but a slow grind for everything else. The box model is not the right tool for chat UIs, settings, modals, or rich sidebars.
2. **Tauri 2 + React + Rust backend** — better dev velocity than the WezTerm fork, but the Rust↔JS boundary slows iteration, the Rust ecosystem has fewer ready-made libraries for what we need (PTY, SSH, SQLite), and Linux packaging is rougher than Electron's.
3. **Electron + React** *(chosen)* — single language end-to-end, mature ecosystem, ships everywhere, every comparable product (VS Code, Wave Terminal, Tabby, Hyper, Cursor, Linear, Notion, Slack, Discord) uses this exact stack.

**The honest trade-off:** binaries are ~150 MB instead of ~10 MB, and idle memory is higher (~200 MB vs ~50 MB). Neither matters for a developer tool — VS Code and Cursor are both larger and nobody complains. The dev velocity and ecosystem wins more than make up for it.

**Performance is not a concern.** xterm.js with the WebGL addon uses the same texture-atlas + instanced-quad technique WezTerm and Alacritty use natively. For typing, scrolling, and normal terminal use, you cannot tell them apart. It's the renderer VS Code's terminal uses, on millions of dev machines daily.

---

## Tech Stack (Locked)

| Layer | Choice | Why |
|---|---|---|
| Runtime | **Electron** (latest stable) | Battle-tested; powers VS Code, Slack, Discord, Cursor; Microsoft-maintained |
| Frontend framework | **React 19 + TypeScript** | Mainstream, ecosystem we know |
| Build tool | **electron-vite** | Vite for both main and renderer, HMR for both, single config |
| Styling | **Tailwind CSS v3** | Utility-first, fast iteration, easy theming |
| Component primitives | **shadcn/ui** (Radix under the hood) | Accessible, copy-paste, no lock-in |
| Terminal grid | **xterm.js** + `@xterm/addon-webgl`, `@xterm/addon-fit`, `@xterm/addon-web-links`, `@xterm/addon-search` | Same as VS Code's terminal; GPU-accelerated via WebGL |
| PTY | **node-pty** | Microsoft-maintained; ConPTY on Windows, native on Mac/Linux |
| SSH | **ssh2** (npm) | Mature, supports keys, passwords, agents, port forwarding |
| SQLite | **better-sqlite3** | Fastest SQLite binding in any language, sync API |
| Secure secrets | **keytar** | OS keychain on Mac/Win/Linux for passwords + API keys |
| State | **Zustand** | Tiny, simple, no boilerplate |
| Icons | **lucide-react** | Clean, consistent, tree-shakeable |
| Markdown (LLM chat) | **react-markdown** + **remark-gfm** + **rehype-highlight** | Standard markdown + GFM tables + code highlighting |
| Webview panes | Electron's built-in `<webview>` tag | No extra dep |
| LLM HTTP | Native `fetch` | Built into Node 22 / Chromium |
| Packaging | **electron-builder** | Most mature; handles Mac signing/notarization, AppImage, msi, exe, deb, rpm |
| Auto-update | **electron-updater** + GitHub Releases | Standard pairing, free, all 3 platforms |
| Testing | **Vitest** (unit), **Playwright** (E2E) | Modern, fast |
| Lint/format | **ESLint + Prettier** | Standard |
| CI | **GitHub Actions** matrix on Ubuntu / macOS / Windows | Standard |

Lock these. Don't reach for an alternative without a strong reason and an explicit decision.

---

## Performance & GPU Acceleration

**The terminal grid must be GPU-accelerated.** This is a hard requirement, not a nice-to-have. We are competing with native terminals (WezTerm, Alacritty, Kitty, iTerm2) that all use GPU rendering, and a slow terminal is an instant deal-breaker for power users.

### How

xterm.js ships three renderers; we use only the WebGL one:

| Renderer | Where | Use |
|---|---|---|
| **WebGL** (`@xterm/addon-webgl`) | GPU via Chromium's WebGL → ANGLE → Metal/D3D/OpenGL | **Default. Always.** |
| Canvas | CPU 2D canvas | Fallback only if WebGL context fails to initialize |
| DOM | HTML spans | Never. Don't even import it. |

The WebGL addon uses the same technique as native GPU terminals:
- Glyphs are rasterized once into a **texture atlas** on the GPU
- Each terminal cell is drawn as an **instanced quad** sampling from the atlas
- Draw calls are batched per frame; no per-cell overhead
- Selection, cursor, and decorations are extra layers on top

This is the same approach WezTerm, Alacritty, and Kitty use natively. Running it through Chromium's WebGL adds a thin abstraction layer but the GPU work itself is identical.

### Implementation rules

```ts
// In TerminalPane.tsx — every terminal must do this:
import { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { FitAddon } from '@xterm/addon-fit';

const term = new Terminal({ /* ... */ });
const fit = new FitAddon();
term.loadAddon(fit);

term.open(container);

// Try WebGL; fall back to canvas only if context creation fails
try {
  const webgl = new WebglAddon();
  webgl.onContextLoss(() => webgl.dispose()); // handle GPU resets
  term.loadAddon(webgl);
} catch (err) {
  console.warn('WebGL renderer unavailable, falling back to canvas', err);
  // canvas addon import + load here
}
```

- **Always** wire `onContextLoss` to dispose and recreate — Chromium can lose the WebGL context on GPU driver crashes, suspend/resume, or tab backgrounding.
- **Never** mix renderers. Pick one per Terminal instance.
- **Disable** xterm.js's built-in DOM renderer fallback path entirely.

### Performance budget

- **Steady-state typing:** 60+ FPS, frame time under 16 ms
- **`cat` of a 100 MB log file:** must not freeze the UI; backpressure into the PTY read loop if needed
- **Idle CPU:** essentially 0% — no animation loops when nothing changes (xterm.js handles this; don't break it)
- **Terminal cell count:** WebGL handles 200×60+ comfortably on integrated GPUs

If we ever ship a build that drops back to the canvas renderer in normal use, treat it as a release blocker.

### Trade-offs we accept

- **Ligatures** are weaker than WezTerm's Harfbuzz path. WebGL renderer disables ligatures by default; an opt-in `addon-ligatures` exists but adds cost. MVP: ligatures off. Post-MVP: opt-in setting.
- **Sub-pixel anti-aliasing** is whatever Chromium gives us — slightly less crisp than native Metal/CoreText on macOS Retina, but indistinguishable on Linux/Windows.
- **Extreme stress tests** (`yes` piped at full speed for minutes) may run ~20–30% slower than WezTerm. Real workloads are unaffected.

These are conscious trade-offs in exchange for the entire HTML/CSS ecosystem being available for everything *around* the terminal.

---

## Terminal Input & Paste Handling

Terminal paste behavior is correctness-critical. Tessera can run terminal-aware apps inside terminal-aware apps, for example `codex` running inside Tessera over a local or SSH PTY. In that setup, a large pasted browser log must arrive as one paste operation, not as many typed/submitted lines.

Implementation rules:

- Custom paste paths must call xterm.js `term.paste(text)`. This includes context-menu paste and `Ctrl+Shift+V`.
- Do not send clipboard text directly to `window.api.pty.write`. That bypasses xterm's paste handling and can break TUIs, shells, editors, and Codex.
- `term.paste(text)` normalizes line endings and applies bracketed paste mode (`\x1b[200~` / `\x1b[201~`) when the running program enables it.
- The PTY write queue may throttle large paste bodies, but it must preserve bracketed paste start/end markers and await each IPC write before sending the next chunk.
- Native paste, context-menu paste, and keyboard paste should share the same path so behavior is consistent.

Regression check:

- Run `codex` inside a Tessera terminal, paste a long multiline browser console log, and confirm Codex recognizes it as a single large pasted chunk instead of many interactive submissions.

---

## Architecture

Electron splits the app into two process types:

- **Main process** (Node.js) — owns the OS window, the SQLite database, all PTY/SSH connections, the LLM API client, the keychain. Single instance per app launch.
- **Renderer process** (Chromium + React) — runs the UI. One renderer per BrowserWindow. **Cannot directly access Node APIs** for security reasons.

These talk over **IPC**:
- `ipcRenderer.invoke` / `ipcMain.handle` for request/response
- `webContents.send` / `ipcRenderer.on` for streaming events from main → renderer

```
┌─────────────────────────────────────────────────┐
│  Main Process (Node.js)                         │
│   ├─ SQLite (better-sqlite3, WAL mode)          │
│   ├─ PTY pool (node-pty)                        │
│   ├─ SSH pool (ssh2)                            │
│   ├─ LLM clients (OpenAI / Anthropic / Ollama)  │
│   ├─ Keychain access (keytar)                   │
│   └─ IPC handlers                               │
└──────────────┬──────────────────────────────────┘
               │ typed IPC contract (preload bridge)
┌──────────────┴──────────────────────────────────┐
│  Renderer Process (Chromium + React)            │
│   ├─ Sidebar (projects, sessions)               │
│   ├─ Tab bar (per-session tabs)                 │
│   ├─ Main panel (one of:)                       │
│   │   ├─ TerminalPane (xterm.js + WebGL)        │
│   │   ├─ LLMChatPane                            │
│   │   └─ WebviewPane (<webview>)                │
│   ├─ Status bar                                 │
│   └─ Zustand store                              │
└─────────────────────────────────────────────────┘
```

### IPC Surface

All IPC messages are typed via a shared `src/shared/ipc.ts`. Naming convention: `domain:action`. The renderer never touches `ipcRenderer` directly — it goes through a typed `window.api` exposed by the preload script.

**Request/response (`invoke`):**

| Channel | Purpose |
|---|---|
| `db:query`, `db:exec` | Internal — only used by handlers above, not exposed to renderer |
| `projects:list` / `:create` / `:rename` / `:delete` / `:reorder` | Project CRUD |
| `sessions:list` / `:create` / `:update` / `:delete` / `:reorder` | Session CRUD |
| `pty:spawn` → `{ ptyId }` | Start a local or SSH PTY |
| `pty:write` `{ ptyId, data }` | Send keystrokes |
| `pty:resize` `{ ptyId, cols, rows }` | Resize from xterm.js |
| `pty:kill` `{ ptyId }` | Terminate |
| `ssh:test-connection` `{ host, user, port, auth }` | Validation before save |
| `llm:send` `{ sessionId, prompt }` → `{ messageId }` | Stream starts via event |
| `llm:list-models` `{ provider }` | Model picker |
| `transcripts:load` `{ sessionId, before?, limit }` | Lazy paginated history |
| `search:fts` `{ query, sessionId? }` | FTS5 search |
| `secrets:get` / `:set` / `:delete` | Keychain wrapper |

**Streaming events (`send` → `on`):**

| Event | Payload |
|---|---|
| `pty:data:<ptyId>` | `string` (UTF-8 chunk) |
| `pty:exit:<ptyId>` | `{ code, signal }` |
| `llm:chunk:<messageId>` | `{ text }` |
| `llm:done:<messageId>` | `{ message }` |
| `mux:notification` | Generic state-change broadcast |

### Security

- BrowserWindow options: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`
- **All exposed APIs go through `electron/preload.ts`** using `contextBridge.exposeInMainWorld('api', { … })`. Never expose raw `ipcRenderer` or `require`.
- `<webview>` tags are partitioned per session and run with `nodeIntegration: false`.
- Strict CSP set in `index.html`.
- Renderer URLs are restricted: `file://` for production, `http://localhost:5173` for dev only.

---

## Project Structure

```
workspace-app/
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── electron.vite.config.ts
├── electron-builder.yml
├── tailwind.config.js
├── postcss.config.js
├── .eslintrc.cjs
├── .prettierrc
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── release.yml
├── electron/
│   ├── main.ts                  # Electron entry point
│   ├── preload.ts               # contextBridge exposure
│   ├── ipc/
│   │   ├── index.ts             # Wires all handlers
│   │   ├── projects.ts
│   │   ├── sessions.ts
│   │   ├── pty.ts
│   │   ├── ssh.ts
│   │   ├── llm.ts
│   │   ├── transcripts.ts
│   │   ├── secrets.ts
│   │   └── search.ts
│   ├── db/
│   │   ├── client.ts            # better-sqlite3 wrapper
│   │   ├── migrate.ts
│   │   └── migrations/
│   │       └── 0001_init.sql
│   ├── pty/
│   │   ├── pool.ts              # PTY lifecycle
│   │   └── transcript-writer.ts # Hooks PTY output → SQLite chunks
│   ├── ssh/
│   │   └── pool.ts
│   ├── llm/
│   │   ├── client.ts            # Provider router
│   │   └── providers/
│   │       ├── openai.ts
│   │       ├── anthropic.ts
│   │       └── ollama.ts
│   └── lifecycle/
│       ├── single-instance.ts
│       └── window.ts
├── src/                         # React renderer
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css                # Tailwind entry
│   ├── shared/
│   │   ├── ipc.ts               # Typed IPC contract (used by both sides)
│   │   └── types.ts
│   ├── lib/
│   │   ├── api.ts               # Wrapped IPC client (window.api)
│   │   └── store.ts             # Zustand store
│   ├── components/
│   │   ├── Sidebar/
│   │   │   ├── index.tsx
│   │   │   └── SessionRow.tsx
│   │   ├── TabBar/
│   │   ├── StatusBar/
│   │   ├── Terminal/
│   │   │   └── TerminalPane.tsx
│   │   ├── LLMChat/
│   │   │   ├── ChatPane.tsx
│   │   │   ├── Message.tsx
│   │   │   └── Composer.tsx
│   │   ├── Webview/
│   │   │   └── WebviewPane.tsx
│   │   ├── modals/
│   │   │   ├── NewSessionModal.tsx
│   │   │   └── SettingsModal.tsx
│   │   └── ui/                  # shadcn primitives (Button, Input, Dialog, etc.)
│   ├── pages/
│   │   └── Workspace.tsx
│   └── hooks/
│       ├── useTerminal.ts
│       └── useLLMStream.ts
└── tests/
    ├── unit/
    └── e2e/
```

---

## Data Model (SQLite)

Schema lives in `electron/db/migrations/0001_init.sql`. Use migrations from day one — even though we're just one file now, the migration runner needs to exist so we never have to retrofit it.

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('terminal','llm','webview')),
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_project ON sessions(project_id);

CREATE TABLE terminal_sessions (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK(mode IN ('local','ssh')),
  shell_path TEXT,
  start_dir TEXT,
  host TEXT,
  username TEXT,
  port INTEGER,
  auth_method TEXT,        -- 'password' | 'key' | 'agent'
  identity_file TEXT
  -- passwords NEVER stored here; use OS keychain via keytar
);

CREATE TABLE llm_sessions (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,  -- 'openai' | 'anthropic' | 'ollama'
  model TEXT NOT NULL,
  system_prompt TEXT
);

CREATE TABLE webview_sessions (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  initial_url TEXT NOT NULL,
  current_url TEXT NOT NULL,
  title TEXT
);

CREATE TABLE session_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  tab_name TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  status TEXT NOT NULL     -- 'running' | 'ended' | 'crashed'
);
CREATE INDEX idx_runs_session ON session_runs(session_id);

CREATE TABLE transcript_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES session_runs(id) ON DELETE SET NULL,
  seq INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  chunk_type TEXT NOT NULL, -- 'output' | 'event'
  content_text TEXT NOT NULL
);
CREATE INDEX idx_chunks_session_seq ON transcript_chunks(session_id, seq);

CREATE TABLE llm_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_msgs_session ON llm_messages(session_id);

-- Full-text search across transcripts
CREATE VIRTUAL TABLE transcript_fts USING fts5(
  content_text,
  content='transcript_chunks',
  content_rowid='id'
);
CREATE TRIGGER transcript_chunks_ai AFTER INSERT ON transcript_chunks BEGIN
  INSERT INTO transcript_fts(rowid, content_text) VALUES (new.id, new.content_text);
END;
CREATE TRIGGER transcript_chunks_ad AFTER DELETE ON transcript_chunks BEGIN
  INSERT INTO transcript_fts(transcript_fts, rowid, content_text) VALUES('delete', old.id, old.content_text);
END;
```

**Persistence rules:**
- Transcripts are *always* stored as append-only chunks. Never store a session as one blob.
- Loading is lazy/paginated: open session → fetch most recent N chunks → on upward scroll past threshold, fetch older.
- Use **WAL mode** for concurrency.
- DB file location: `app.getPath('userData')/workspace.db` — cross-platform standard, resolves to:
  - Linux: `~/.config/workspace-app/workspace.db`
  - macOS: `~/Library/Application Support/workspace-app/workspace.db`
  - Windows: `%APPDATA%\workspace-app\workspace.db`
- **Passwords and API keys are NEVER stored in SQLite.** Use `keytar` (OS keychain).
- Migrations are forward-only. Each migration is idempotent and runs on app boot if its version isn't recorded.

---

## UI Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  ◆ Workspace                │ logs │ deploy │  +                │
│  ─────────────────────────  │─────────────────────────────────  │
│  INFRA              +       │                                   │
│   ● prod-server      ssh    │                                   │
│   ● staging-db       ssh    │         MAIN PANEL                │
│   ● local dev       local   │   (terminal / chat / webview)     │
│  AI TOOLS           +       │                                   │
│   ✦ debug chat       llm    │                                   │
│   ◉ grafana          web    │                                   │
│                             │                                   │
│  + New Session              │                                   │
│  ◐ 5 active                 │                                   │
├─────────────────────────────┴───────────────────────────────────┤
│  ● 5 sessions    RAM 2.3 GB    CPU 12%       workspace · dev    │
└─────────────────────────────────────────────────────────────────┘
```

- Sidebar width: ~240 px fixed (collapsible later, post-MVP)
- Sidebar always visible in MVP
- Top tab bar shows tabs **within the active session** (only meaningful for terminal sessions)
- Main panel renders the appropriate component for the active session type
- Bottom status bar is minimal, low-contrast, ~24 px tall

The exact React shell from the earlier `/home/esteban/terminal/workspace` Tauri prototype ports over 1:1 — same components, same Tailwind palette, same layout.

### Color palette (dark, locked in `tailwind.config.js`)

```
bg.DEFAULT      #15161a
bg.header       #0f1014
bg.active       #272a31
bg.footer       #10131a
divider         #2d2f37
accent          #5fb3fa
fg.DEFAULT      #dee0e8
fg.dim          #9a9ea7
fg.muted        #6b6f78
fg.bright       #f9faff
fg.button       #73baf7
dot.on          #59db89
dot.off         #73767e
dot.llm         #bb80f2
dot.web         #73c4f5
```

---

## Build, Run, Package

### Dev workflow

```bash
npm install
npm run dev          # electron-vite serves renderer + spawns Electron with HMR for both
```

`electron-vite` handles HMR for both the main and renderer processes. Main process changes restart Electron automatically.

### Production build

```bash
npm run build        # electron-vite build (main + preload + renderer)
npm run package      # electron-builder for current platform
npm run dist         # electron-builder for all configured platforms
```

### Cross-platform packaging

`electron-builder.yml` config produces:

- **macOS:** `.dmg` + `.zip`, code-signed with Apple Developer ID, notarized (via env vars in CI)
- **Windows:** `.exe` (NSIS installer) + portable `.zip`, code-signed (EV cert recommended)
- **Linux:** `.AppImage` + `.deb` + `.rpm`

GitHub Actions matrix-builds on `ubuntu-latest` / `macos-latest` / `windows-latest` and publishes artifacts to a GitHub Release on `v*` tag push. Auto-update via `electron-updater` reads `latest.yml` from the Release.

---

## Implementation Phases

### Phase 1 — Foundation
- Scaffold Electron + electron-vite + React + TS + Tailwind
- Port the existing sidebar / tab bar / status bar / terminal-pane components from `/home/esteban/terminal/workspace`
- Initialize SQLite with the v1 schema + migration runner
- Wire up real PTY via node-pty: spawn local shell, pipe stdin/stdout to xterm.js (with WebGL renderer)
- Projects + sessions CRUD persisted to SQLite
- Sidebar reads sessions from SQLite (replacing the hardcoded placeholder data)

### Phase 2 — History & Tabs
- Hook PTY output stream into transcript chunk writer (append to SQLite, batched)
- Lazy load on session open (most recent N chunks, default 500)
- Upward scroll pagination (fetch older chunks, prepend, preserve scroll position)
- Session runs / per-tab tracking
- Connection event markers (connected, disconnected, reconnected)

### Phase 3 — SSH Sessions
- ssh2 connection pool in main process
- "New SSH Session" form: host / user / port / auth method
- "Test Connection" button before save
- Key file picker; password via OS keychain (keytar), never plain in DB
- SSH terminal piped through xterm.js the same way as local

### Phase 4 — LLM Sessions
- Provider abstraction (OpenAI / Anthropic / Ollama)
- BYO API key stored in keychain via keytar
- Streaming responses via IPC events
- Markdown rendering with code highlighting (react-markdown)
- Messages persisted to `llm_messages`
- Per-session model and system prompt config

### Phase 5 — WebView Sessions
- `<webview>` component with URL bar, back, forward, reload
- "Open in external browser" escape hatch (always present)
- Persist current URL on navigation

### Phase 6 — Search & Polish
- SQLite FTS5 search across transcripts (per-session and global)
- Bottom status bar with real RAM/CPU (via `os` module in main)
- Keyboard shortcuts (Cmd/Ctrl+T new tab, +W close, +K command palette)
- Reconnect flows
- Settings page

### Phase 7 — Packaging & Release
- electron-builder config finalized for all 3 platforms
- GitHub Actions release pipeline
- Code signing (Apple Developer ID + Windows EV cert)
- Auto-update wired via electron-updater
- Landing page + download links

---

## Conventions

- **Single language end-to-end (TypeScript).** No Rust, no Go, no native code beyond what `node-pty` and `better-sqlite3` already give us.
- **All UI uses Tailwind + shadcn primitives.** No CSS-in-JS, no styled-components, no separate CSS modules.
- **All persistence goes through `electron/db/`.** No ad-hoc file I/O for app data. SQLite is the source of truth.
- **Transcripts are always chunked, never single blobs.** Append-only.
- **Never load full transcript history into memory.** Always paginate.
- **Secrets (LLM API keys, SSH passwords) live in OS keychain via keytar — never in SQLite.**
- **All IPC is typed.** `src/shared/ipc.ts` defines a single contract used by both sides.
- **Main process owns all state mutations to disk.** Renderer asks via IPC; never writes to disk directly.
- **Renderer is sandboxed.** `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`. Preload script exposes only the typed IPC surface.
- **xterm.js always uses the WebGL renderer.** Fall back to canvas only if WebGL fails to initialize.
- **WebView sessions always include "Open in external browser" as a fallback.**
- **Session creation forms are minimal and progressive:** only show fields relevant to the chosen type/mode.
- **Don't add features beyond what was asked.** A bug fix doesn't need surrounding code cleaned up. A simple feature doesn't need extra configurability.

---

## Pricing & Distribution

- **Free tier:** full local app — terminal, SSH, LLM (BYO key), webview, projects, history, search
- **Pro (one-time, ~$39–$79):** advanced search, encryption at rest, export, extra UI features
- **Upgrade model:** major version upgrades are optional paid upgrades (~$19–$39)
- **No subscription. No cloud. No telemetry by default.** Local-first is a core product value.

License keys are validated locally — a small server signs a license file at purchase time, the app verifies the signature offline. No phone-home.

---

## Testing Strategy

- **Unit:** Vitest for pure logic (parsing, schema helpers, transformations)
- **Integration:** Vitest for IPC handlers with an in-memory SQLite
- **E2E:** Playwright driving the actual built Electron app, exercising full UI flows
- Snapshot test the SQLite schema migration output

Aim for: 100% of IPC handlers covered by integration tests, smoke E2E test for each phase deliverable.

---

## References

- Electron docs: https://www.electronjs.org/docs/latest
- electron-vite: https://electron-vite.org
- xterm.js: https://xtermjs.org
- xterm.js WebGL addon: https://github.com/xtermjs/xterm.js/tree/master/addons/addon-webgl
- node-pty: https://github.com/microsoft/node-pty
- better-sqlite3: https://github.com/WiseLibs/better-sqlite3
- electron-builder: https://www.electron.build
- electron-updater: https://www.electron.build/auto-update
- shadcn/ui: https://ui.shadcn.com
- Radix UI primitives: https://www.radix-ui.com
- ssh2: https://github.com/mscdex/ssh2
- keytar: https://github.com/atom/node-keytar
- VS Code (reference architecture): https://github.com/microsoft/vscode
- Wave Terminal (reference): https://github.com/wavetermdev/waveterm
- Tabby (reference): https://github.com/Eugeny/tabby
