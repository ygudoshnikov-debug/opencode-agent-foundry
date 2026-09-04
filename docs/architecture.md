# Architecture

## The whole picture

```
┌───────────────────────────────────────────────────────────────────────────┐
│                                 OpenCode                                  │
│                                                                           │
│   chat session ── selected model ──┐                                      │
│                                    │ (inherited, not configured)          │
│   ┌────────────────────────────────▼──────────────────────────────────┐   │
│   │                    opencode-agent-foundry                         │   │
│   │                                                                   │   │
│   │   agents/          orchestrator · architect · lead · analyst ·    │   │
│   │                    builder      — roles only, never model names   │   │
│   │                                                                   │   │
│   │   tools/           foundry_* — thin wrappers over the engine      │   │
│   │        engine.ts   ALL state transitions live here                │   │
│   │                                                                   │   │
│   │   core/            types · store · graph · board                  │   │
│   │   orchestration/   scheduler · validator · router · delegation    │   │
│   │   context/         packet.ts — per-role context budgets           │   │
│   │   config/          schema · loader (+ v1 migration)               │   │
│   │   runtime/         host.ts ── the seam to OpenCode itself:        │   │
│   │                      catalogue, chat model, dispatch a role       │   │
│   │                    setup.ts ─ session gate + the runtime view     │   │
│   │                                                                   │   │
│   │   desktop/                                                        │   │
│   │        lifecycle.ts ── owns bridge + window, independently        │   │
│   │        bridge.ts ───── HTTP + SSE, 127.0.0.1, bearer token        │   │
│   │        launcher.ts ─── finds and spawns the native binary         │   │
│   │        protocol.ts ─── the wire contract (types only)             │   │
│   └────────────────────────────────┬──────────────────────────────────┘   │
└────────────────────────────────────┼──────────────────────────────────────┘
                                     │
                    <project>/.agent-foundry/   ← single source of truth
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        │                            │                            │
        ▼                            ▼                            ▼
   chat replies              agentfoundry CLI              desktop bridge
                                                                  │
                                          HTTP + SSE on 127.0.0.1 │ Bearer token
                                                                  ▼
                                                      ┌───────────────────────┐
                                                      │   Tauri shell (Rust)  │
                                                      │   single instance     │
                                                      │   bridge_config()     │──┐
                                                      └───────────┬───────────┘  │
                                                                  │              │ token
                                                                  ▼              │ via IPC,
                                                      ┌───────────────────────┐  │ never
                                                      │  WebView              │  │ in a URL
                                                      │  React + TypeScript   │◄─┘
                                                      │  Dashboard · Kanban   │
                                                      │  Tasks · Graph ·      │
                                                      │  Events · Settings    │
                                                      └───────────────────────┘
```

---

## Decisions and why

### The orchestrator inherits the chat model by omission

`AgentConfig.model` is optional in OpenCode. When it is absent, the runtime resolves the agent to
the session's model. So instead of adding a "default orchestrator model" setting and keeping it in
sync with the chat, the orchestrator's agent definition simply **has no `model` key**.

Consequences: the user changes the model in the chat and the orchestrator follows, with no second
configuration surface and nothing to drift. `src/agents/index.ts` enforces this — it only emits
`model` when a binding actually exists.

The same mechanism gives the other roles a sensible zero-config default: unbound roles also inherit
the chat model, so a fresh install works with no configuration at all.

### Agents are registered through the `config` hook, not returned

The `Hooks` interface in `@opencode-ai/plugin` exposes `tool`, `config`, `event` and `dispose` —
there is **no `agent` key**. Returning `agent: {...}` from the plugin is silently ignored. Agents and
commands are contributed by mutating the object passed to the `config` hook, which is what
`src/index.ts` does. Existing user definitions win, so a project can override anything.

### The plugin dispatches roles; the orchestrator never relays a packet

The first design had the orchestrator delegate by printing the context packet into chat under an
`@builder` mention. Every packet was therefore billed twice — as the orchestrator's output tokens
and again as the builder's input — and the wording that actually reached the builder was whatever
the orchestrator chose to paraphrase, not what `packet.ts` had budgeted.

`runtime/host.ts` is the seam: `catalogue()`, `sessionModel()` and `dispatch()`. The OpenCode-backed
implementation creates a child session and prompts it directly. `orchestration/delegation.ts` builds
the packet and sends it there.

What this buys, none of which was reachable through the relay:

- The packet is written by code and read by the role. It never enters the orchestrator's context.
- The model is read from configuration **at dispatch time**. Rebinding a role takes effect on the
  next dispatch with no restart — see the next section for why that matters.
- Each role gets a tool allowlist. A builder cannot call planning or dispatch tools at all.
- Concurrency is the plugin's decision, so `max_parallel: 0` can mean genuinely unlimited.

An offline host is the default, so every path stays testable and headless use never touches the
network. With no host, `foundry_execute` reports the failure rather than marking work done.

### Model rebinding cannot work through agent re-registration

OpenCode 1.18.18 loads only v1 plugins (`{id, server}`). A v2 plugin (`{id, setup}`) does not load
at all — verified with a control experiment, not inferred from the types. That rules out
`ctx.agent.reload()` and any live re-registration: an agent's `model` is frozen when OpenCode starts.

So configuration changes cannot reach a role through its agent definition. They reach it through
dispatch instead, which is resolved per call. This is why the previous section is not merely an
optimisation — it is the only mechanism by which "change the model and it applies immediately" can
be true on this runtime.

### The flow is enforced at the tool layer, not only in the prompt

The ordering used to live entirely in the orchestrator's system prompt. A model that lost the thread
could record evidence for a task that never ran, review one still in flight, or apply a plan while
its own questions sat unanswered — each producing a board that reports something that did not
happen, which is worse than an error because the run continues on top of it.

`engine.ts` refuses those transitions outright: `foundry_apply_plan` with an unanswered question,
`foundry_complete`/`foundry_fail` on a task that is not `IN_PROGRESS`, `foundry_review` on one that
is not in `REVIEW`, and execution before a plan has produced tasks. Every refusal names the state
the task is actually in and the call that fixes it, so the model recovers in one turn.

This also lets the tool descriptions shrink: they no longer narrate the flow, because the code
enforces it. Descriptions are re-sent on every request; a `next` hint costs tokens only on the turn
its tool runs.

### One execution flow

Execution modes (`restricted` / `automatic` / `full`) are gone: type, config field, tool, commands
and scheduler branch. The scheduler now always does the same thing — take everything whose
dependencies are satisfied, order by priority then by how much work it unblocks, and start as many
as the parallelism ceiling and the file locks allow.

The autonomy the modes provided is preserved by mechanisms that were doing the real work anyway:
`execution.max_parallel`, dependency gating, review gates, `execution.max_retries` with escalation,
and the cost limits. Choosing a mode was a decision the user had to make before understanding the
problem; the ceiling is a number they can set once.

### The Kanban board is a projection, not a second store

`tasks/*.json` is the only source of truth. The board is derived from it on demand
(`src/core/board.ts`), which is why the chat, the CLI and the desktop window can never disagree.
Summaries are deliberately small — the board is read by a language model on every check.

### The desktop bridge: HTTP + SSE over loopback

Considered: Tauri IPC proxying to Node, a WebSocket, and direct HTTP.

Chosen: **HTTP for requests, SSE for live updates, both on `127.0.0.1`.** Reasons, in the priority
order the requirements set out:

- *Simplicity* — the plugin already runs in a Node-compatible runtime; `node:http` needs no
  dependency, and the WebView's `fetch` needs no client library. Routing everything through Rust
  would mean re-implementing each endpoint twice.
- *Security* — loopback binding plus a per-process bearer token compared in constant time. The
  token reaches the page through a Tauri command, so it never appears in a URL, history entry or
  referrer. The handshake file is owner-only and deleted on stop.
- *Latency* — loopback HTTP is sub-millisecond; SSE pushes changes rather than polling.
- *Operational complexity* — one server, no protocol negotiation, no reconnect handshake beyond
  what SSE gives for free.

The surface is a fixed, small endpoint list. There is no filesystem, shell or proxy route, so a
hostile page inside the WebView cannot escalate through it.

### Two independent halves of the desktop feature

The bridge (a server) and the window (a process) are owned by `DesktopLifecycle` but are
deliberately decoupled:

- **Window closed, plugin alive** → the bridge keeps running, so reopening is instant.
- **Plugin stops, window alive** → the bridge closes and the UI shows a disconnected state with
  Retry. Killing a visible window because a plugin reloaded would be hostile.

Window reuse is enforced twice: the lifecycle will not spawn while a child is alive, and the Tauri
shell registers `tauri-plugin-single-instance`, which focuses the existing window and exits when a
second process starts. That second path is what makes "open it again" behave like "bring it to the
front".

The bridge is created lazily on first use (unless `desktop.autostart` is set), so a headless user
never pays for a server they will not open. Its socket is `unref`'d, so it can never hold OpenCode
open.

### Cost is a design constraint, not a report

A real run of the previous design built a tic-tac-toe app and consumed 32% of a five-hour quota.
The forensics and the fixes:

| Finding | Fix |
|---|---|
| `project.json` reached 39 KB, **98.7% duplicated planning payloads** | Plans moved to `plans/<id>.json`; `project.json` keeps a compact ref list |
| Tool results were `JSON.stringify(task, null, 2)` including history, evidence and gates | Purpose-built summaries, unindented; detail is opt-in per call |
| One `foundry_task_create` call per task | `foundry_apply_plan` creates the whole plan, resolving refs to ids |
| 7 of 20 tasks cancelled on runtime file-lock conflicts | `WorkGraph.fileOverlaps()` reports overlapping independent tasks at plan time, via `foundry_doctor` |
| 1.9 attempts per task, unbounded history re-sent each retry | History capped, `output_summary` truncated on write, packets carry only the last failure |
| Every event append re-read the whole log to compute a sequence number | Sequence cached in the store; counted once |
| `project.json` rewritten once per task creation | Project cached in memory, ids allocated in bulk, one `flush()` per operation |
| Dependency propagation rebuilt the graph per dependent task | One graph, one pass |
| Four overlapping plans proposed the same tasks | Planning is scoped per author, and the orchestrator prompt says so explicitly |

The largest remaining lever is context size, which is why `src/context/packet.ts` exists and why
each role has a token budget.

### Anchors

Human decisions, frozen contracts and acceptance criteria are recorded as anchors. `taskUpdate`
refuses a patch that removes or rewrites one and tells the caller to escalate instead. A system can
be perfectly self-consistent and still be solving the wrong problem; anchors are the fixed points
that make that detectable.

---

## Desktop gotchas worth knowing

Four things about this stack fail in ways that look like something else. Each cost real debugging
time and is now pinned by a test.

**The WebView is not same-origin with the bridge, so CORS applies.** Tauri serves the page from
`http://tauri.localhost` (Windows) or `tauri://localhost`, and the UI fetches `http://127.0.0.1:<port>`.
Because every request carries an `Authorization` header, the browser sends a preflight `OPTIONS`
first — and a preflight has no token by definition. Answering it from behind the auth gate returns
401, the UI never connects, and the window still opens looking perfectly healthy. The bridge
therefore answers preflights before authenticating, and echoes only allowlisted origins (the Tauri
origins plus loopback), never a wildcard. The token remains the security boundary; CORS is not.

**Detect Tauri with `__TAURI_INTERNALS__`, not `__TAURI__`.** The latter exists only when
`withGlobalTauri` is enabled. Checking for it fails silently in a correctly configured app.

**Import `@tauri-apps/api/core` statically.** A dynamic `import()` becomes its own chunk, and a
chunk that fails to load inside the packaged app is indistinguishable from "not running in Tauri" —
the UI renders as disconnected with nothing in any log to explain it.

**Build through the Tauri CLI, not `cargo build`.** Raw cargo leaves Tauri in dev mode, so the
packaged binary loads `devUrl` (`http://localhost:5173`) instead of the embedded frontend and shows
the WebView's "can't reach this page". Use `npm run desktop:build`. Note also that
`beforeDevCommand` / `beforeBuildCommand` run from the **package root**, not from `src-tauri/`,
while `frontendDist` is resolved relative to `tauri.conf.json`.

**A dead bridge does not always announce itself.** Two distinct failures look identical from the
page's side, and both were reproduced against the real desktop app:

- *Clean shutdown* — the plugin stopping ends the SSE stream with `done` and no error. Treating
  that as "nothing happened" left a healthy indicator over data that would never update again.
- *Abrupt death* — a killed process leaves the socket dangling; the reader simply never returns.
  Nothing at all arrives to signal the drop.

So the stream treats a clean close as a disconnect, AND runs a watchdog: the bridge pings every
25 seconds, so silence past 70 seconds means the connection is gone regardless of what anyone
reported. Reconnection attempts also re-resolve the address and token every time, because the
plugin rotates its token on each start — a window that reused the token it loaded with could never
come back.

**Reopening the board must force a reconnect.** The single-instance guard focuses the existing
window rather than creating one, so reopening after a plugin restart hands the user a window still
holding a token that can no longer work. The shell therefore emits `foundry://reopen`, and the page
resubscribes unconditionally — "already connected" is not evidence, for the reason above. Focusing
a native window does not reliably raise a DOM focus event, which is why the explicit event exists.

When a window opens but shows nothing, set `FOUNDRY_DESKTOP_PROBE=1` before launching. The shell
then reports back what the page actually contains — whether Tauri's internals are present, whether
React mounted, what the page believes its connection status to be, and the first of any error —
which is otherwise invisible in a release build with no devtools. `FOUNDRY_PROBE_URL` points those
reports at a collector of your choosing instead of the bridge.

## Platform notes

| | Windows | macOS | Linux |
|---|---|---|---|
| Runtime requirement | WebView2 (preinstalled on 11) | System WebKit | WebKitGTK 4.1 |
| Build requirement | Rust + MSVC C++ build tools | Rust + Xcode CLI tools | Rust + `webkit2gtk-4.1`, `libayatana-appindicator3` |
| Binary path | `src-tauri/target/release/*.exe` | `…/Agent Foundry.app/Contents/MacOS/Agent Foundry` | `src-tauri/target/release/<crate>` |
| Handshake file mode | `chmod` is best-effort; NTFS ACLs do not map onto POSIX modes | 0600 enforced | 0600 enforced |

`npm run desktop:doctor` checks all of these and prints the exact command to fix whatever is missing.

---

## Testing

| Layer | Runner | Covers |
|---|---|---|
| Backend | `node:test` against `dist/` | config + v1 migration, store, graph, scheduler, validator, full engine lifecycle, bridge over real HTTP, launcher |
| Web UI | vitest + Testing Library | API client, SSE parsing, bridge resolution, board rendering, settings invariants, shortcuts |
| Desktop | `cargo test` | argument/env parsing, handshake fallback, state management |
| Wiring | `scripts/smoke.mjs` | plugin loads, tools present, agents registered via the config hook, **no agent carries a default model**, no mode concept survives, task lifecycle reaches the board |

The smoke test encodes the architectural invariants, so a regression that reintroduces a hardcoded
model or an execution mode fails the build rather than shipping.
