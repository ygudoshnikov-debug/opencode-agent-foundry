# Contributing

Thanks for taking an interest. This is a small project with strong opinions, so the fastest route
to a merged change is knowing which opinions are load-bearing.

## Getting set up

```bash
git clone https://github.com/gjoliveira9634/opencode-agent-foundry
cd opencode-agent-foundry
npm install
npm install --prefix web
npm run verify
```

`npm run verify` is the gate: typecheck for the plugin and the web app, the backend test suite, the
smoke test, the web tests, the compiled-CSS audit and the preset audit. It should be green before
you open a pull request and green again after.

The desktop shell is optional. You need it only if you are changing `src-tauri/` or `web/`:

```bash
npm run desktop:build     # needs Rust and cargo on PATH
npm run desktop:doctor    # tells you what is missing and where it looked
```

On Windows, `cargo` is often absent from Git Bash's PATH while present in PowerShell. `tauri build`
exits 0 even when it cannot find cargo, so check the binary's timestamp after building rather than
trusting the exit code.

## The invariants

`CLAUDE.md` lists them and `scripts/smoke.mjs` enforces them. A pull request that trips the smoke
test is not a broken test — it is the test doing its job. The short version:

- **Agents are named by role, never by model.** `orchestrator`, `architect`, `lead`, `analyst`,
  `builder`. A model id belongs in configuration, never in an agent's identity.
- **The plugin ships no model defaults.** With no configuration every role inherits the model
  selected in the chat. The vendor presets are a menu; nothing in them applies until someone picks
  one.
- **One flow.** There are no execution modes and there will not be any.
- **The orchestrator dispatches; it never relays a context packet through chat.** Relaying bills the
  same tokens twice and lets the model paraphrase what the code carefully budgeted.
- **Tool results stay small.** Every byte a tool returns is read by a language model at someone's
  expense. This is a cost constraint, not a style preference.

## Changes that need a test

- A new state transition, or a change to an existing one → `test/*.test.mjs`
- A change to what the orchestrator is told → check the fixed per-turn cost has not grown
- A change to the preset table → `npm run check:presets` must stay green, including the ladder rule
- Anything in `web/` → `npm run check:styles`, because a deleted stylesheet leaves a green build and
  an unstyled screen

## Style

Match the file you are editing. Comments explain **why**, especially where the obvious approach was
tried and rejected — several of the stranger-looking decisions here exist because the obvious one
silently broke. If your comment restates the code, delete it.

## Reporting a bug

Include the OpenCode version, your platform, and the contents of `.agent-foundry/events.jsonl` for
the run if you can share it. That log is usually enough to reconstruct what happened.
