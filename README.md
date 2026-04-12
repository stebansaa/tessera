# Tessera

A unified developer workspace that combines persistent terminal sessions (local + SSH), embedded web pages, and project organization into a single desktop application. Built with Electron, React, and xterm.js.

Tessera replaces the juggling of multiple terminal windows, SSH clients, and browser tabs with one cohesive workspace where every session is persistent, searchable, and reconnectable.

## Features

### Terminal Sessions
- **Local shell** with configurable shell path and starting directory
- **SSH connections** with key, password, or agent authentication
- GPU-accelerated terminal rendering via xterm.js WebGL addon
- 50,000-line scrollback buffer
- Automatic session reconnection on disconnect

### Transcript History
- All terminal output is stored locally in SQLite as append-only chunks
- Replay previous session output on reconnect (byte-capped at 256KB for performance)
- Paginated lazy loading on scroll-up for older history
- Full-text search (FTS5) across all transcripts
- Per-session storage stats and clear controls in settings

### Tabbed Workspace
- Multiple tabs per connection (terminal + web pages)
- Tab 1 is always the terminal connection; additional tabs can be terminal or webview
- Webview tabs use Electron's `<webview>` with URL bar, back/forward/reload, and open-in-browser
- Tab state (including webview URLs) persists across app restarts

### Sidebar & Organization
- Connections listed in stable user-defined order
- Manual reorder with up/down controls
- Pin connections to the top of the list
- Connection status indicators (green dot = connected)
- Remembers last active connection on restart

### Connection Management
- Create, edit, and delete connections
- SSH settings: host, port, username, auth method, identity file, password (encrypted via OS keychain with Electron safeStorage)
- Starting directory support for both local and SSH sessions
- Safe deletion requiring exact name confirmation

### Appearance
- 8 built-in color schemes: Dark, Midnight, Nord, Solarized Dark, Solarized Light, Monokai, Rose Pine, Light
- Configurable terminal font family and size
- Accent color customization
- Full-window theming (sidebar, tabs, terminal, status bar)

### Keyboard Shortcuts
- `Ctrl+T` / `Cmd+T` &mdash; New terminal tab
- `Ctrl+W` / `Cmd+W` &mdash; Close current tab
- `Ctrl+Shift+C` &mdash; Copy selection
- `Ctrl+Shift+V` &mdash; Paste from clipboard
- `Ctrl+Tab` / `Ctrl+Shift+Tab` &mdash; Cycle tabs
- `Ctrl+1`&ndash;`9` &mdash; Switch to tab N
- Right-click &mdash; Context menu (Copy, Paste, Select All)
- `Enter` on disconnected session &mdash; Reconnect

## Architecture

```
Main Process (Node.js)
  ├── SQLite (better-sqlite3, WAL mode)
  ├── PTY pool (node-pty)
  ├── SSH pool (ssh2)
  ├── Transcript writer (batched PTY output -> SQLite)
  ├── Electron safeStorage (password encryption)
  └── IPC handlers

Renderer Process (Chromium + React)
  ├── Sidebar (connections, pin, reorder)
  ├── Tab bar (terminal + webview tabs)
  ├── Terminal views (xterm.js + WebGL)
  ├── Webview tabs (Electron <webview>)
  ├── Settings panel (appearance, storage)
  └── Connection forms (create/edit/delete)
```

All communication between main and renderer goes through typed IPC channels defined in `src/shared/ipc.ts`. The renderer is fully sandboxed (`nodeIntegration: false`, `contextIsolation: true`). All APIs are exposed through `contextBridge` in the preload script.

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Electron 33 |
| Frontend | React 19 + TypeScript |
| Build | electron-vite (Vite for main + renderer) |
| Styling | Tailwind CSS 3 |
| Terminal | xterm.js 5 with WebGL addon |
| PTY | node-pty |
| SSH | ssh2 |
| Database | better-sqlite3 (WAL mode, FTS5) |
| Secrets | Electron safeStorage (OS keychain) |
| State | Zustand |
| Icons | lucide-react |

## Requirements

- **Node.js** 22 LTS recommended
- **npm** 9 or later
- **Platform:** Linux, macOS, or Windows
- A C++ toolchain for native module compilation (`node-pty`, `better-sqlite3`):
  - **Linux:** `sudo apt install build-essential python3`
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`)
  - **Windows:** Visual Studio Build Tools with C++ workload

Notes:

- The project currently works best with **Node 22 LTS**. Newer major Node releases may fail to build native dependencies.
- Linux and macOS are the primary tested development targets today.
- Windows support is intended, but should still be treated as lightly tested until the local shell and SSH flows are validated on a Windows machine.

## Installation

```bash
git clone https://github.com/stebansaa/tessera.git
cd tessera
npm install
```

The `postinstall` script automatically runs `electron-rebuild` to compile `better-sqlite3` and `node-pty` against Electron's Node version.

If you have multiple Node versions installed, make sure `node` and `npm` resolve to Node 22 before running `npm install` or `npm run dev`.

## Development

```bash
npm run dev
```

This starts electron-vite in dev mode with HMR for both the main and renderer processes. Changes to React components hot-reload instantly; changes to main process code restart Electron automatically.

## Building

```bash
npm run build      # Build main + preload + renderer
npm run start      # Preview the production build
```

## Releases

Package artifacts are built with `electron-builder`.

```bash
npm run dist
```

GitHub Releases are built automatically by the workflow in `.github/workflows/release.yml` when you push a version tag:

```bash
git tag v0.1.1
git push origin v0.1.1
```

The release workflow builds platform-native artifacts on:

- macOS
- Windows
- Linux

It then uploads those artifacts to the matching GitHub Release.

## Project Structure

```
tessera/
├── electron/
│   ├── main/index.ts           # Electron entry, PTY handlers, window setup
│   ├── preload/index.ts        # contextBridge API exposure
│   ├── db/
│   │   ├── client.ts           # SQLite connection (WAL mode)
│   │   ├── repo.ts             # All database operations
│   │   ├── migrate.ts          # Migration runner
│   │   ├── migrations/
│   │   │   └── 0001_init.sql   # Schema: sessions, transcripts, FTS5, settings
│   │   └── seed.ts             # Default data seeding
│   ├── ipc/                    # IPC handler registration
│   │   ├── sessions.ts
│   │   ├── projects.ts
│   │   ├── transcripts.ts
│   │   ├── settings.ts
│   │   ├── search.ts
│   │   └── dialog.ts
│   ├── ssh/spawn.ts            # SSH connection via ssh2
│   └── pty/transcript-writer.ts # Batched PTY output -> SQLite
├── src/
│   ├── App.tsx                 # Main app component, state management
│   ├── shared/ipc.ts           # Typed IPC contract (shared by main + renderer)
│   ├── lib/
│   │   ├── theme.ts            # Theme context provider
│   │   └── color-schemes.ts    # 8 built-in color schemes
│   └── components/
│       ├── Sidebar.tsx         # Connection list with reorder + pin
│       ├── TabBar.tsx          # Tab bar with terminal/webview tab creation
│       ├── TerminalView.tsx    # xterm.js terminal with WebGL, transcript replay
│       ├── TerminalTabs.tsx    # Multi-tab container (terminal + webview)
│       ├── WebviewTab.tsx      # Embedded web page with URL bar
│       ├── SessionForm.tsx     # Create/edit connection form with safe delete
│       ├── SessionPanel.tsx    # Session detail panel orchestrator
│       ├── ThemePanel.tsx      # Appearance settings + storage management
│       └── StatusBar.tsx       # Bottom status bar
├── electron.vite.config.ts
├── tailwind.config.js
├── tsconfig.json
└── package.json
```

## Data Storage

All data is stored locally on your machine. No cloud, no telemetry.

- **Database:** `~/.config/tessera/tessera.db` (Linux), `~/Library/Application Support/tessera/tessera.db` (macOS), `%APPDATA%/tessera/tessera.db` (Windows)
- **Passwords:** Encrypted with Electron safeStorage (OS keychain) and stored as encrypted blobs in SQLite. Cleartext is never written to disk.
- **Transcripts:** Append-only chunks in SQLite with FTS5 indexing for full-text search.
- **Settings:** Theme, tab state, and last active session stored in `app_settings` table.

## Database Schema

The schema uses SQLite with WAL mode and foreign keys enabled:

- `projects` &mdash; Workspace grouping (default project auto-created)
- `sessions` &mdash; Connections (terminal/ssh)
- `terminal_sessions` &mdash; SSH/local config per session (host, port, auth, encrypted password)
- `session_runs` &mdash; Each PTY spawn lifecycle (running/ended/crashed)
- `transcript_chunks` &mdash; Append-only terminal output with sequence numbers
- `transcript_fts` &mdash; FTS5 virtual table for full-text search across transcripts
- `app_settings` &mdash; Key-value store for theme, tabs, preferences

## License

MIT - see [LICENSE](LICENSE)

## Author

Esteban
