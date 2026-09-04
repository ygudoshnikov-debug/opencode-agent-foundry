# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Positioning and documentation.** The project is presented as hierarchical agent orchestration
  for OpenCode: a rewritten README, a documentation set under `docs/` (getting started, agent
  hierarchy, execution model, configuration reference, surface reference, desktop console,
  architecture, cost and context, use cases, troubleshooting), ready-to-copy configuration examples
  under `examples/`, and rewritten contribution, security and conduct policies.
- **Desktop console theme.** Custom `light` and `dark` DaisyUI themes aligned with the brand mark:
  neutral surfaces, one orange accent, semantic color reserved for states. The dashboard is
  restyled around a stats row with neutral values.
- **Dependency graph layout.** Nodes are placed by dependency depth, so the critical path reads
  left to right and no row is clipped, and edges leave the dependent and land on the dependency.
- **Preset label.** The fourth vendor preset is labeled "OpenCode Go" (its id stays `china`).
- **Sample project.** `scripts/demo.mjs` seeds a billing-service migration with ten tasks across
  every interesting column; `--configured` seeds a configured project so the console opens on the
  dashboard. Screenshots are regenerated from it.
- **Wording.** User-facing strings say "desktop console"; the orchestrator's picker description is
  written in the third person.
- **Verification gate.** `npm run check:links` verifies every relative Markdown link and heading
  anchor and runs inside `npm run verify`; the graph layout has a test that pins the layered order.

### Fixed

- The JSON schema now allows `execution.max_parallel: 0` (unlimited) with no upper bound, matching
  the runtime schema, and declares the `configured` field.
- The console's event-type filter listed event types that do not exist (`PLAN_PROPOSED`,
  `PLAN_ACCEPTED`, `QUESTION_RAISED`); it now lists the real ones.

## [1.0.1] — 2026-09-04

### Fixed

- `npm test` failed on Windows under Node 20 with "Could not find test/*.test.mjs". The script
  relied on a shell glob, which Linux shells expand and PowerShell does not, and which Node itself
  only expands from version 22 — so it passed everywhere it was tried and failed on the first CI
  run. Test discovery now happens in `scripts/run-tests.mjs`, which reads the directory and passes
  explicit paths, giving the same result on every Node version, shell and platform.

## [1.0.0] — 2026-09-04

First stable release. The plugin, the desktop console and the wire contract between them are now
covered by semantic versioning.

### Added

- **Vendor presets.** Four teams — OpenAI, Anthropic, Google and OpenCode Go — each filling all four
  roles at once. Every role carries an ordered candidate list that resolves against the models your
  account can actually reach, so a preset written on one machine works on another. A role with no
  reachable candidate falls back to the chat model instead of writing an id that would fail later.
- **A setup screen in the desktop console**, replacing four dropdowns that each defaulted to "use
  defaults". It shows the model behind every role before you pick.
- **`check:presets`** — verifies every preset id against OpenCode's own model catalogue, refuses
  alpha, preview and moving `-latest` builds as primaries, refuses a cost ladder that climbs from
  architect to builder, and reports each pick's age. Deliberate departures are recorded in code with
  a reason.
- **`check:styles`** — asserts every `className` in the web app resolves to real CSS in the built
  bundle, because deleting a stylesheet while its class names remain gives a passing build and an
  unstyled screen.
- MIT license, contribution guide, security policy, code of conduct, issue and pull request
  templates, and CI covering Linux and Windows.

### Changed

- **The orchestrator now dispatches roles itself** instead of relaying a context packet through the
  chat. The packet never enters the orchestrator's output, so the same tokens are no longer billed
  twice, and the worker receives exactly what the code composed rather than a paraphrase.
- **Model bindings resolve at dispatch time.** Rebinding a role takes effect on the next call with
  no restart. OpenCode cannot re-register an agent once loaded, so this is the only mechanism by
  which "change the model and it applies now" can be true.
- **Session setup is one question with two answers** — keep the current setup, or open the window to
  change it — asked once per conversation whether or not the project was configured before.
- **Step ordering is enforced in the engine**, not only in the prompt. A plan cannot be applied with
  an unanswered question, evidence cannot be recorded for work that never started, and a task cannot
  be reviewed before it reported evidence. Each refusal names the state and the call that fixes it.
- **`max_parallel: 0` now means unlimited**, starting every task whose dependencies and file locks
  allow it, rather than being capped at an arbitrary ceiling.
- The desktop UI was rebuilt on DaisyUI for one consistent visual language across every screen.
- The orchestrator prompt and the tool descriptions were cut to about 1,400 tokens per turn
  combined, with the tool-description share held under budget by the smoke test.

### Fixed

- `POST /api/setup` returned a write summary while the client's types claimed a full runtime view,
  so the page silently lost its model catalogue and bindings after saving.
- The desktop console opened on the dashboard when a configured project asked to reconfigure,
  dropping the request.
- A brand new project reported an unreachable preset as its current selection, because an empty
  configuration and a fully unavailable preset both resolve to no bindings.
- Tailwind was never wired into the web build, so `@import "tailwindcss"` shipped verbatim and every
  utility class resolved to nothing.
- A CORS preflight was rejected by the auth gate, so the window could never reach the bridge while
  looking healthy.
- Config files without a `version` field were treated as v1 and had their `desktop`, `context`,
  `limits` and `pricing` sections dropped on migration.

### Security

- The bridge token is written to a `0600` handshake file and read from there, rather than passed on
  a command line or in a URL where other processes on the machine can read it.
- The CORS origin allowlist is explicit; preflight is answered before the auth gate, and never with
  a wildcard.

[Unreleased]: https://github.com/gjoliveira9634/opencode-agent-foundry/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/gjoliveira9634/opencode-agent-foundry/releases/tag/v1.0.1
[1.0.0]: https://github.com/gjoliveira9634/opencode-agent-foundry/releases/tag/v1.0.0
