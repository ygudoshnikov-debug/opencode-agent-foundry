# CLAUDE.md — opencode-agent-foundry

An OpenCode plugin (TypeScript, ESM, built with `tsc`). Hierarchical agent orchestration: an
orchestrator agent clarifies an objective, plans onto a Kanban board, dispatches role-based agents
in parallel and reports back. Ships a Tauri + React desktop console. State lives in each project's
`.agent-foundry/` directory.

## Build and verify (run from this folder)

```bash
npm run build         # plugin -> dist/
npm run verify        # typecheck (plugin + web) + backend tests + smoke + preset audit + web tests + style audit
npm run smoke         # architectural invariants; fails if a regression reintroduces coupling
npm run check:styles  # every className in web/src must resolve to real CSS in the built bundle
npm run check:presets # preset ids exist, no unstable primaries, ladder descends, ages reported
npm run desktop:doctor
npm run demo          # seed the sample project and hold a bridge open for the console
```

`check:styles` exists because a build and a green test suite both pass happily when a stylesheet is
deleted while its class names stay in the markup; only the compiled CSS proves otherwise.

The desktop binary needs cargo on PATH. Under Git Bash it usually is not, and `npx tauri build`
still exits 0 after failing to find it, so build it from PowerShell and check the binary's
timestamp afterwards.

Real end-to-end (needs `opencode` and auth): select the `orchestrator` agent in a scratch directory
and give it a small objective.

## Architecture

- `src/index.ts` — plugin entry (`export default { id, server }`). Registers tools directly, and
  agents + commands through the **`config` hook** (the `Hooks` interface has no `agent` key; a
  returned `agent:` object is silently ignored by the runtime).
- `src/core/` — `types.ts` (domain, 9 Kanban statuses, legacy status migration), `store.ts` (file
  persistence, cached event sequence, capped history), `graph.ts` (deps, cycles, critical path,
  blast radius, file overlaps), `board.ts` (the Kanban projection).
- `src/orchestration/` — `scheduler.ts` (one flow: deps + parallelism ceiling + file locks),
  `validator.ts` (evidence, gates, anchors), `router.ts` (escalation targets, cost estimation and
  limits; `routeTask` is a policy function the engine does not call), `delegation.ts` (builds a
  packet and dispatches it to a role).
- `src/runtime/` — `host.ts` (the seam to OpenCode: model catalogue, chat model, dispatch a role;
  plus the per-role tool allowlist), `opencode-host.ts` (SDK-backed), `setup.ts` (the session gate
  and the runtime view).
- `src/context/packet.ts` — per-role context budgets. The main cost lever.
- `src/tools/engine.ts` — **all** state transitions. `definitions.ts` only wraps it.
- `src/desktop/` — `protocol.ts` (wire contract, types only), `bridge.ts` (loopback HTTP + SSE),
  `launcher.ts`, `lifecycle.ts`.
- `src/config/` — zod schema + loader (v1 → v2 migration), and `presets.ts`: the four vendor teams,
  each role an ordered candidate list resolved against the live catalogue.
- `web/` — React + Vite WebView app (DaisyUI, custom `light`/`dark` brand themes in
  `web/src/main.css`). `src-tauri/` — the native shell.
- `scripts/demo.mjs` — the sample project used for screenshots (a billing-service migration).

Put new behaviour in `engine.ts` first; every other surface is a view onto it. Design decisions,
the cost model and the testing strategy are in `docs/architecture.md`.

## Invariants — the smoke test enforces these, do not break them

- **Agent names and descriptions may not reference an LLM model, vendor or version.**
  Roles are `orchestrator`, `architect`, `lead`, `analyst`, `builder`. An agent's identity is its
  organizational function, never the model it happens to run on.
- **The plugin ships no model defaults.** With an empty configuration every role falls through to
  the model selected in the chat. `src/config/presets.ts` names real models on purpose: it is a
  menu, not a default, and nothing in it applies until a human picks it. The smoke test checks both
  halves: agents carry no `model`, and a fresh project has no bindings.
- **The orchestrator's agent definition must have no `model` key**, so it inherits the model
  selected in the chat. Never add a "default orchestrator model" setting.
- **No execution modes.** There is one flow. Do not reintroduce `restricted`/`automatic`/`full`.
- **The orchestrator never relays a context packet through chat.** The plugin dispatches roles
  itself, so the packet is billed once and the model is resolved from config at dispatch time.
  Reintroducing `foundry_start_task` brings the double billing back; the smoke test fails if it
  reappears.
- **`max_parallel: 0` means unlimited**, not "none". `Infinity` must never reach a surface; the
  scheduler reports `0`.
- **Step ordering is enforced in `engine.ts`**, not only in the prompt. Refusals name the state and
  the call that fixes it. Do not move these checks into tool descriptions.
- **Tool descriptions stay under ~700 tokens in total.** They are re-sent on every request; put
  flow guidance in each result's `next` field instead. The smoke test enforces the budget.
- Every state change goes through `engine.ts` and appends to the event log.
- Tool results stay compact: no pretty-printed JSON, no full task documents by default. This is a
  cost constraint, not a style preference.
- Only one primary agent, so the picker shows a single entry point.
- The desktop layer is additive: the plugin must work fully with Tauri absent.

## Documentation and positioning

The canonical one-liner is "Hierarchical agent orchestration for OpenCode." The product is
presented as an orchestration and governance layer for OpenCode agents, for professional teams.

Terminology: *desktop console* (never "desktop window" or "desktop app"), *context packet*,
*context budget*, *review gates* (execution, test, review, architecture, acceptance), *anchors*,
*escalation ladder*, *blast radius*, *critical path*, *plugin-side dispatch*. The fourth preset is
labeled **OpenCode Go**; its id stays `china`.

Writing rules for every document, comment or release note:

- No first person, no autobiography, no anecdotes about earlier projects, no quota figures from
  personal runs. Measured findings from the earlier design are cited impersonally, only in
  `docs/architecture.md`.
- No toy examples (hello world, tic-tac-toe, calculators). Examples are professional engineering
  scenarios; `docs/use-cases.md` and `scripts/demo.mjs` hold the approved ones.
- No hype words. Every capability claim names the mechanism that enforces it.
- Cost limits surface a `cost_warning` on completion; they do not refuse or stop work. Tokens and
  cost are estimates, never measurements. `routeTask` is not applied automatically; escalation
  moves one rung per `foundry_escalate` call.
- American English, sentence-case headings, relative links, prose wrapped at about 100 characters.

Document ownership: `README.md` (landing page), `docs/README.md` (index), `docs/getting-started.md`,
`docs/agents.md`, `docs/execution-model.md`, `docs/configuration.md`, `docs/reference.md`,
`docs/desktop.md`, `docs/architecture.md`, `docs/cost-and-context.md`, `docs/use-cases.md`,
`docs/troubleshooting.md`, `examples/README.md`, `scripts/README.md`.

## After changing `src/` or `web/`

Rebuild, run `npm run verify`, and restart OpenCode to reload the plugin. If the console changed,
regenerate the screenshots from `scripts/demo.mjs` so the README shows the current interface.
