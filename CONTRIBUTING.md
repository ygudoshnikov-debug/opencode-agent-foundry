# Contributing to Agent Foundry

This document describes the development workflow, testing requirements, and architectural
principles that shape contributions to Agent Foundry.

## Development setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/gjoliveira9634/opencode-agent-foundry
cd opencode-agent-foundry
npm install
npm install --prefix web
npm run verify
```

The `npm run verify` command is the primary gate. It runs typechecking (plugin and web),
the backend test suite, smoke tests, web tests, the compiled-CSS audit, the preset audit and the documentation link check.
All of these must pass before opening a pull request.

### Desktop shell

The desktop console is optional. You need to build it only when changing code in
`src-tauri/` or `web/`:

```bash
npm run desktop:build     # Requires Rust and cargo on PATH
npm run desktop:doctor    # Reports missing dependencies and where to install them
```

On Windows, `cargo` is often absent from Git Bash's PATH but present in PowerShell.
The Tauri CLI exits with code 0 even when cargo cannot be found, so verify the binary's
timestamp after building rather than relying on the exit code.

On macOS and Linux, see CLAUDE.md §5 (platform requirements) for WebKit/system
dependencies.

## Verification gate

`npm run verify` proves these properties:

| Property | Command | Why it matters |
|----------|---------|----------------|
| TypeScript correctness (plugin) | `tsc -p tsconfig.json` | Type errors propagate to runtime and cost tokens. |
| TypeScript correctness (web) | `npm --prefix web run typecheck` | Frontend type safety catches refactoring mistakes. |
| Backend logic | `npm test` (runs `scripts/run-tests.mjs`, 97 tests) | State transitions, scheduling, validation, and tool ordering are load-bearing. |
| Architectural invariants | `npm run smoke` (runs `scripts/smoke.mjs`) | Plugin loads, agents are named by role not model, no model defaults ship, no execution modes, tool descriptions fit the token budget. |
| Web component tests | `npm run test:web` (62 vitest tests) | UI components handle the protocol correctly. |
| Compiled CSS coverage | `npm run check:styles` | A deleted stylesheet leaves the markup intact but unstyled; only compiled CSS proves otherwise. |
| Preset validity | `npm run check:presets` | Preset ids exist in the OpenCode catalogue, model ladder does not climb, ages are reported. |
| Documentation links | `npm run check:links` | A renamed file or heading leaves a link that still renders and fails only when a reader clicks it. |

## Architectural invariants

These are enforced by the smoke test. A pull request that triggers one is not a broken
test — the test is doing its job. The invariants are:

- **Agent identity is organizational function, never model.** Roles are `orchestrator`,
  `architect`, `lead`, `analyst`, and `builder`. A model id belongs in configuration,
  never in an agent's identity or description.
- **No model defaults ship with the plugin.** With an empty configuration, every role
  inherits the model selected in the chat. Vendor presets exist as a menu; nothing in
  them applies until a human chooses one.
- **The orchestrator's agent definition has no `model` property**, so it inherits the
  chat model. Changing the chat model changes the orchestrator immediately.
- **One flow, no modes.** There is no restricted/automatic/full execution mode. The
  plugin has one path from clarification through execution to completion.
- **The orchestrator never relays a context packet through chat.** The plugin dispatches
  roles itself via the OpenCode session API, so context packets are billed once at
  dispatch time, never duplicated as relay messages.
- **Step ordering is enforced in the engine, not only in prompts.** Refusals to break
  the order name the actual state and the call that fixes it. Do not move these guards
  into tool descriptions.
- **Tool descriptions fit a fixed budget.** Descriptions are re-sent on every request;
  the budget is 700 tokens total across all tools. Flow guidance belongs in the result
  `next` field, which is only paid when the tool runs.
- **Tool results stay compact.** Every byte a tool returns is read by a language model
  at someone's expense. No pretty-printed JSON; task documents returned by default only
  summarize key fields; detail is available on request via the `detail` parameter.

## Changes that require a test

| Change | Test |
|--------|------|
| New state transition or modification to an existing one | `test/*.test.mjs` (backend test suite) |
| Change to what the orchestrator receives in its prompt | Verify the fixed per-turn cost has not grown |
| Change to the preset table or model bindings | `npm run check:presets` must pass; preset ladder rules upheld |
| Anything in `web/` | `npm run check:styles` to prove all classes have CSS; vitest tests for logic |
| Changes to the command line interface | Add a test under `test/` that drives the engine the CLI calls |
| Changes to the desktop bridge protocol | Bridge tests and desktop E2E tests |

## Code style

Match the file you are editing. Comments explain **why**, especially where an obvious
approach was tried and found to break something — many of the unusual patterns here
exist for that reason.

Comments that merely restate the code add noise; delete them. Instead, explain:
- Why the non-obvious choice was made.
- What silent failure it prevents.
- Any cross-cutting concern it touches.

Examples:

```typescript
/**
 * Refuses an out-of-order transition.
 *
 * The flow used to live only in the orchestrator's prompt, which meant a
 * model that lost the thread could complete a task it never started, review
 * one that was still running, or apply a plan while its own questions sat
 * unanswered — each producing a board that lies about what happened. The
 * message names the state and the correct next call, so the model recovers
 * in one turn instead of guessing.
 */
const refuse = (what: string, why: string, next: string): never => {
  throw new Error(`${what}: ${why}. ${next}`);
};
```

Code follows the language defaults: TypeScript strict mode, Rust idiom, React hooks
for the web layer. Match the file you are editing and run `npm run verify` before committing.

## Documentation style

Documentation must be mechanism-backed, not hype-backed. Every claim names what enforces
or implements it. Avoid:
- Autobiography or anecdotes about past projects.
- First-person singular ("I", "my").
- Toy examples (hello world, tic-tac-toe, personal calculators).
- Empty buzzwords ("seamless", "powerful", "revolutionary").
- Unverified numbers or benchmarks.

Approved example scenarios appear in docs/use-cases.md. They are professional engineering
challenges (service migration, security hardening, framework upgrade, production
debugging, architecture review, pipeline build-out).

Point readers to the positioning rules in CLAUDE.md when documenting new features.
Use relative links between files. Markdown prose wraps at 100 characters. Code
identifiers go in backticks; commands in fenced blocks with a language tag.

## Commits and pull requests

### Commit messages

Write concise, imperative-mood messages that explain the "why" when the "what" is not
obvious. Example:

```
Trim context packets on line boundary to preserve JSON structure

A packet over budget was split mid-value, leaving unparseable JSON.
Trimming on a line boundary and marking truncation preserves parseable
structure for the model to handle gracefully.
```

### Pull requests

Include a one-or-two-sentence summary of what behavior is different after merge, the
problem you solved (including any non-obvious approaches tried and rejected), and a
checklist:

- `npm run verify` is green.
- New behavior has a test, or you have documented why it does not need one.
- No model, vendor, or version name was added to an agent's identity.
- No model default was added that would apply without user selection.
- Tool results and prompts did not grow without a reason proportionate to the tokens.

## Release process

Releases are tagged on `main` as `v*` (e.g., `v1.0.2`). The release workflow
automatically builds desktop binaries for Windows x64, Linux x64, and macOS arm64
and attaches them to the GitHub release.

### Before tagging

1. Update version numbers in three places:
   - `package.json` (`version` field)
   - `src-tauri/Cargo.toml` (`package.version`)
   - `src-tauri/tauri.conf.json` (`version`)

2. Update `CHANGELOG.md`: add an entry describing the changes, linking to relevant
   commits or pull requests.

3. Commit and push these changes to `main`.

4. Run `npm run verify` locally to confirm the gate passes.

### Tagging and publishing

After commit, create and push the tag:

```bash
git tag v1.0.2
git push origin v1.0.2
```

The Release workflow will start automatically, building desktop binaries for all three
platforms and uploading them to the GitHub release.

To publish the npm package:

```bash
npm publish
```

This runs `prepublishOnly`, which in turn runs `npm run verify`. The package must pass
all verification checks before publishing.

The npm package should be published after the desktop binaries are built and the
GitHub release is created (the workflow attaches the binaries; verify they appeared
before publishing).
