# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] — 2026-09-04

### Fixed

- `npm test` failed on Windows under Node 20 with "Could not find test/*.test.mjs". The script
  relied on a shell glob, which Linux shells expand and PowerShell does not, and which Node itself
  only expands from version 22 — so it passed everywhere it was tried and failed on the first CI
  run. Test discovery now happens in `scripts/run-tests.mjs`, which reads the directory and passes
  explicit paths, giving the same result on every Node version, shell and platform.

## [1.0.0] — 2026-09-04

First stable release. The plugin, the desktop window and the wire contract between them are now
covered by semantic versioning.

### Added

- **Vendor presets.** Four teams — OpenAI, Anthropic, Google and China — each filling all four roles
  at once. Every role carries an ordered candidate list that resolves against the models your
  account can actually reach, so a preset written on one machine works on another. A role with no
  reachable candidate falls back to the chat model instead of writing an id that would fail later.
- **A setup screen in the desktop window**, replacing four dropdowns that each defaulted to "use
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
- The desktop window opened on the dashboard when a configured project asked to reconfigure,
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

[1.0.1]: https://github.com/gjoliveira9634/opencode-agent-foundry/releases/tag/v1.0.1
[1.0.0]: https://github.com/gjoliveira9634/opencode-agent-foundry/releases/tag/v1.0.0
