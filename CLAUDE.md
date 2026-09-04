# CLAUDE.md — opencode-agent-foundry

An OpenCode plugin (TypeScript, ESM, built with `tsc`). An orchestrator agent asks what it needs,
plans onto a Kanban board, delegates to role-based agents and reports back. Ships a Tauri + React
desktop window. State lives in each project's `.agent-foundry/` directory.

## Build and verify (run from this folder)

```bash
npm run build        # plugin -> dist/
npm run verify       # typecheck (plugin + web) + backend tests + smoke + web tests + style audit
npm run smoke        # architectural invariants; fails if a regression reintroduces coupling
npm run check:styles # every className in web/src must resolve to real CSS in the built bundle
npm run check:presets # preset ids exist, no unstable primaries, ladder descends, ages reported
npm run desktop:doctor
```

`check:styles` exists because a build and a green test suite both pass happily when a stylesheet is
deleted while its class names stay in the markup — the app just renders unstyled. Only the compiled
CSS proves otherwise.

The desktop binary needs cargo on PATH. Under Git Bash it usually is not, and `npx tauri build`
still exits 0 after failing to find it, so build it from PowerShell and check the binary's
timestamp afterwards.

Real end-to-end (needs `opencode` and auth): select the `orchestrator` agent in a scratch directory
and give it a small objective.

## Architecture

- `src/index.ts` — plugin entry (`export default { id, server }`). Registers tools directly, and
  agents + commands through the **`config` hook** (the `Hooks` interface has no `agent` key — a
  returned `agent:` object is silently ignored by the runtime).
- `src/core/` — `types.ts` (domain, 9 Kanban statuses, legacy status migration), `store.ts` (file
  persistence, cached event sequence, capped history), `graph.ts` (deps, cycles, critical path,
  blast radius, file overlaps), `board.ts` (the Kanban projection).
- `src/orchestration/` — `scheduler.ts` (one flow: deps + parallelism ceiling + file locks),
  `validator.ts` (evidence, gates, anchors), `router.ts` (role routing, config-driven cost),
  `delegation.ts` (builds a packet and dispatches it to a role).
- `src/runtime/` — `host.ts` (the seam to OpenCode: model catalogue, chat model, dispatch a role;
  plus the per-role tool allowlist), `opencode-host.ts` (SDK-backed), `setup.ts` (the session gate
  and the runtime view).
- `src/context/packet.ts` — per-role context budgets. The main cost lever.
- `src/tools/engine.ts` — **all** state transitions. `definitions.ts` only wraps it.
- `src/desktop/` — `protocol.ts` (wire contract, types only), `bridge.ts` (loopback HTTP + SSE),
  `launcher.ts`, `lifecycle.ts`.
- `src/config/` — zod schema + loader (v1 → v2 migration), and `presets.ts`: the four vendor teams,
  each role an ordered candidate list resolved against the live catalogue.
- `web/` — React + Vite WebView app. `src-tauri/` — the native shell.

Put new behaviour in `engine.ts` first; every other surface is a view onto it.

## Invariants — the smoke test enforces these, do not break them

- **Agent names and descriptions may not reference an LLM model, vendor or version.**
  Roles are `orchestrator`, `architect`, `lead`, `analyst`, `builder`. An agent's identity is its
  organisational function, never the model it happens to run on.
- **The plugin ships no model defaults.** With an empty configuration every role falls through to
  the model selected in the chat. `src/config/presets.ts` names real models on purpose — it is a
  menu, not a default, and nothing in it applies until a human picks it. The smoke test checks both
  halves: agents carry no `model`, and a fresh project has no bindings.
- **The orchestrator's agent definition must have no `model` key**, so it inherits the model
  selected in the chat. Never add a "default orchestrator model" setting.
- **No execution modes.** There is one flow. Do not reintroduce `restricted`/`automatic`/`full`.
- **The orchestrator never relays a context packet through chat.** The plugin dispatches roles
  itself, so the packet is billed once and the model is resolved from config at dispatch time.
  Reintroducing `foundry_start_task` brings the double billing back; the smoke test fails if it
  reappears.
- **`max_parallel: 0` means unlimited**, not "none". `Infinity` must never reach a surface — the
  scheduler reports `0`.
- **Step ordering is enforced in `engine.ts`**, not only in the prompt. Refusals name the state and
  the call that fixes it. Do not move these checks into tool descriptions.
- **Tool descriptions stay under ~700 tokens in total.** They are re-sent on every request; put
  flow guidance in each result's `next` field instead. The smoke test enforces the budget.
- Every state change goes through `engine.ts` and appends to the event log.
- Tool results stay compact — no pretty-printed JSON, no full task documents by default. This is a
  cost constraint, not a style preference.
- Only one primary agent, so the picker shows a single entry point.
- The desktop layer is additive: the plugin must work fully with Tauri absent.

## After changing `src/`

Rebuild, run `npm run verify`, and restart OpenCode to reload the plugin.
