# Desktop console

This document covers the desktop console screens, connection mechanism, binary setup,
development loop, and diagnostics.

The desktop console is a native Tauri window that gives Agent Foundry's board, tasks,
dependencies, and events an always-on home beside the chat. It connects to the plugin
via a loopback bridge. The window stays open and shows disconnected until the bridge
is back.

## The console screens

Keyboard shortcut `g` opens the navigation menu; then press `d`, `k`, `g`, `t`, `e`, or
`s` to navigate.

**Dashboard** (`g d`): Project overview with objective, current phase, and progress as
a percentage. Shows running and blocked tasks, open questions (if any), and real-time
totals: task count, cost in USD, tokens consumed, and plan count.

**Kanban** (`g k`): A board with columns for each task status, collapsed by default when
empty. Cards show ID, status, title, owner and executor badges, module, attempts,
dependency and blocked counts, and blast radius. Click a card to open its detail panel
with acceptance criteria, required gates, dependencies, and history. The filter input
(press `/`) narrows by title or ID.

**Graph** (`g g`): A directed graph of task dependencies. Nodes show task ID and status;
edges show which tasks wait for which. Zoom and pan with mouse. The critical path is
highlighted, and blocking edges are shown as dashed lines.

**Tasks** (`g t`): A sortable table with one row per task, columns for ID, title,
status, owner, executor, module, attempts, and blast radius. Click a row to open the
detail panel.

**Events** (`g e`): An append-only audit log. Shows "N recorded" and a type filter.
Each row shows relative time and event details. Scroll to see older events.

**Settings** (`g s`): Configuration for the current project. Editable fields: per-role
model bindings (except the orchestrator, which always inherits the chat model),
concurrent builders count, and theme. Read-only fields show file overlaps, retries,
and cost limits. Changes are written to the project config file immediately.

**Setup screen** (shown while the project is unconfigured, and whenever a chat session asked to
reconfigure through `foundry_setup`): Shows
four vendor presets (OpenAI, Anthropic, Google, OpenCode Go) plus options to "Inherit
from chat" or "Choose per role". The models behind each role are resolved against the
account's reachable models. A preset with unreachable roles shows a badge "N roles
unreachable" and lists which roles inherit from chat. Edit the "Concurrent builders"
number and toggle "Unlimited", then click "Save setup".

## Keyboard shortcuts

| Keys | Action |
|------|--------|
| `g` | Open the navigation menu (then press d/k/g/t/e/s to navigate) |
| `/` | Focus the filter input |
| `?` | Toggle this shortcuts overlay |
| `Esc` | Close panels and overlays |

## How it connects

The console and the plugin talk through a **bridge**: a loopback-only HTTP server on
127.0.0.1 with an ephemeral port and a bearer token generated per process.

### Bridge security

- **Loopback binding only** — the server is unreachable from the network.
- **Bearer token** — a 64-character hex token generated fresh per process, compared
  in constant time, and never appearing in a URL. The shell reads the owner-only
  handshake file to obtain it and passes it to the page through a Tauri IPC command.
- **Handshake file** — `.agent-foundry/desktop.json`, created at 0600 (owner-readable
  only, best-effort on Windows), deleted when the bridge stops. Holds the bridge URL,
  token, project directory, process ID, and start timestamp.
- **CORS allowlist** — restricted to Tauri WebView origins (`tauri://localhost`,
  `http://tauri.localhost`) and loopback addresses. Preflights are answered before
  authentication (the WebView sends a preflight because it is not same-origin with
  the bridge).

### Bridge endpoints

All endpoints except `/api/health` require the `Authorization: Bearer <token>` header.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/health` | Unauthenticated liveness check. Returns `{ ok: true, protocol: <version> }`. |
| GET | `/api/project` | Project summary: objective, phase, progress, totals, costs. |
| GET | `/api/board` | Kanban board: tasks grouped by status. |
| GET | `/api/graph` | Task dependency graph. |
| GET | `/api/tasks` | Task list, filterable by status or module. Query params: `?status=READY&module=auth`. |
| GET | `/api/tasks/:id` | Task detail with full history and evidence. |
| GET | `/api/events` | Audit log. Query param: `?limit=50` (default). |
| GET | `/api/doctor` | Doctor report: errors, warnings, file overlaps, stalled work. |
| GET | `/api/config` | Current configuration. |
| GET | `/api/runtime` | Setup state: model bindings, catalogue, resolved presets, setup request flag. |
| GET | `/api/stream` | Server-sent events. Connection header: `keep-alive`. |
| POST | `/api/setup` | Apply setup choice. Body: `{ choice, preset?, models, builders }`. |
| POST | `/api/config/model` | Set one role's model binding. Body: `{ role, model }`. |
| POST | `/api/questions/answer` | Answer an open question. Body: `{ id, answer }`. |
| PATCH | `/api/tasks/:id` | Update a task (e.g. add a note, update status). Body: partial task object. |

### Server-sent events (SSE)

The `/api/stream` endpoint sends frames as newline-delimited JSON:

```
data: {"type": "hello", "protocol": 3, "directory": "..."}

data: {"type": "invalidate", "scopes": ["board", "project"]}

data: {"type": "event", "event": {...}}

data: {"type": "ping", "at": "2026-09-04T10:30:00Z"}
```

Frame types:

- `hello` — first frame, confirms protocol version and project directory.
- `invalidate` — sent whenever state changes. Scopes: `board`, `project`, `graph`,
  `config`, `events`. The UI refetches affected endpoints.
- `event` — a newly appended audit log entry.
- `ping` — sent every 25 seconds. The console treats 70 seconds of silence as
  disconnection and reconnects, re-resolving address and token.

### Reconnection

When the console reconnects (either after closing and reopening the stream or after a
watchdog timeout), it:

1. Re-reads the handshake file via the Tauri shell (shell IPC) to get the current URL and
   token (because the plugin rotates the token on each start).
2. Subscribes to `/api/stream` with the new token.
3. Receives a `hello` frame confirming protocol and project directory, then refetches
   every scope after reconnection.

If the handshake file is missing or unreadable, the console shows a disconnected state
with a Retry button. Clicking Retry reloads the page. The console does not time out
waiting for Retry; reconnection is user-initiated.

## Building or downloading the binary

The desktop console is optional; the plugin works fully headless without it. To use the
console, build or download the Tauri application.

### Building from source

**Prerequisites**:

- Rust (from https://rustup.rs/). Cargo must be on `PATH`.
- Platform-specific build requirements (checked by `npm run desktop:doctor`):
  - **Windows**: WebView2 runtime (preinstalled on Windows 11; download from
    https://developer.microsoft.com/en-us/microsoft-edge/webview2/ if absent) and MSVC
    build tools (from Visual Studio Community).
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`).
  - **Linux**: WebKit2GTK headers (`libwebkit2gtk-4.1-dev`, `libappindicator3-dev`,
    `librsvg2-dev`, `patchelf`).

**Build steps**:

```bash
npm run desktop:doctor  # Verify all prerequisites
npm run desktop:build   # Build the Tauri app
```

The binary is placed in `src-tauri/target/release/`:

- Windows: `opencode-agent-foundry-desktop.exe` or `Agent Foundry.exe`
- macOS: `Agent Foundry.app/Contents/MacOS/Agent Foundry`
- Linux: `opencode-agent-foundry-desktop`

**Note on Windows and Git Bash**: Cargo is often absent from Git Bash's `PATH` even
when installed. Build from PowerShell instead and verify the binary's timestamp to
confirm the build succeeded (Tauri CLI exits 0 even when cargo is missing).

### Downloading from a release

Navigate to https://github.com/gjoliveira9634/opencode-agent-foundry/releases. On the
latest release (or the version you want), download the asset for your platform:

- Windows x64: `agent-foundry-desktop-windows-x64.exe`
- macOS arm64: `agent-foundry-desktop-macos-arm64`
- Linux x64: `agent-foundry-desktop-linux-x64`

Make the binary executable (on macOS and Linux: `chmod +x`), then place it in
`src-tauri/target/release/` relative to your checkout of the plugin. If you do not have
a checkout, create one:

```bash
git clone https://github.com/gjoliveira9634/opencode-agent-foundry
cd opencode-agent-foundry
mkdir -p src-tauri/target/release
# Move the downloaded binary here
mv ~/Downloads/agent-foundry-desktop-* src-tauri/target/release/
```

When `/foundry-ui` is called, the launcher searches for the binary in standard locations
and spawns it.

## Dev loop

To develop the console and the bridge:

```bash
npm run dev
```

`scripts/dev.mjs` starts three processes and stops them together on Ctrl+C:

1. The TypeScript compiler in watch mode (`tsc -w`), rebuilding the plugin into `dist/`.
2. The Vite dev server on http://localhost:5173, serving the React UI with hot reload.
3. `tauri dev`, spawning the window in debug mode against the dev server.

`npm run desktop:dev` runs only the last step; Tauri starts the Vite dev server itself through
`beforeDevCommand`. The web bundle reloads on every edit; a change under `src/` needs the plugin
rebuilt, which the watcher does.

### Viewing the UI in a browser

The dev server runs on http://localhost:5173. Open it in a browser to see the UI
in real-time while you edit. The bridge URL and token are printed by `npm run demo`:

```bash
npm run demo         # Seed a demo project and print the bridge address
```

Then visit `http://localhost:5173?url=<URL>&token=<TOKEN>` in your browser to connect
the UI to the bridge without Tauri.

### Testing the demo scenario

```bash
npm run demo -- --open
```

This seeds a billing migration scenario with 10 tasks (two DONE, one REVIEW, one
IN_PROGRESS, one FAILED, five PLANNED) and launches the console window. Use this to
test the UI and the bridge under load.

### Running end-to-end tests

```bash
npm run e2e:desktop
```

This starts a demo project, launches the console, and runs end-to-end checks: verifies
authenticated bridge requests over loopback, confirms the handshake file is written
then removed, checks that the native binary starts and stays alive, and confirms a
second launch does not create a second process. It exits 0 if all checks pass, 1 if
any fail.

## Diagnostics

When the window opens but shows nothing or reports disconnected, collect diagnostics.

### Enable probe reporting

Set the environment variable before launching:

```bash
export FOUNDRY_DESKTOP_PROBE=1
npm run desktop:dev
```

The Tauri shell then reports what it sees on startup: whether Tauri's internals are
present, whether React mounted and the app initialized, connection status, and any
errors.

By default, reports go to the bridge's `/api/stream` endpoint. To send them elsewhere,
set `FOUNDRY_PROBE_URL`:

```bash
export FOUNDRY_DESKTOP_PROBE=1
export FOUNDRY_PROBE_URL=http://localhost:3000/probe
npm run desktop:dev
```

## Failure modes

### WebView does not load

The window opens but shows "Cannot reach this page" or similar.

**Likely cause**: The Tauri build was run with raw `cargo build` instead of the Tauri
CLI. This leaves the app in dev mode, so it looks for the frontend at
`http://localhost:5173` instead of the embedded bundle.

**Fix**: Rebuild with `npm run desktop:build`. Check the binary timestamp to confirm
success.

### Window connects then shows disconnected

The console opens, connects briefly, then shows "Disconnected — Retry" persistently.

**Likely cause**: The bridge is running but the token in memory does not match the token
in the handshake file. This happens when the plugin restarted and rotated the token, but
the window still holds the old token.

**Fix**: Click Retry, or close and reopen the window. A manual reconnect forces a fresh
read of the handshake file.

### Window shows disconnected immediately

The console opens and shows disconnected without attempting to connect.

**Likely cause**: The handshake file (`.agent-foundry/desktop.json`) is missing or
unreadable.

**Check**: In the `.agent-foundry/` directory, verify the file exists and is readable
(mode 0600). If missing, the bridge may not have started; check the plugin terminal for
errors.

### CORS preflight fails

The browser console shows a 403 or 401 on an `OPTIONS` request.

**Likely cause**: The origin is not in the allowlist, or the preflight is answered from
behind the authentication gate.

**Fix**: Verify the request comes from a Tauri WebView (`tauri://localhost`,
`http://tauri.localhost`) or a loopback address (`localhost`, `127.0.0.1`, `[::1]`).
If the UI runs on a non-standard dev port, add it as a loopback origin.

### "Cannot detect Tauri" in the console

The UI renders as disconnected even though the window is running.

**Likely cause**: The check for Tauri internals is looking for the wrong global. The UI
checks `__TAURI_INTERNALS__`, not `__TAURI__` (which exists only when `withGlobalTauri`
is enabled).

**Fix**: This is a configuration issue, not a user issue. Verify the Tauri config has the
correct plugin settings.

### Bridge not found when opening

Running `/foundry-ui` shows an error: "The desktop console binary has not been built yet."

**Likely cause**: The binary does not exist at the expected location.

**Fix**: Run `npm run desktop:doctor` to check prerequisites, then build with `npm run
desktop:build`. Alternatively, download a prebuilt binary from GitHub releases and
place it in `src-tauri/target/release/`.

