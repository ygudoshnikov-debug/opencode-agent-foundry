<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/gjoliveira9634/opencode-agent-foundry/main/assets/logo-dark.svg">
    <img src="https://raw.githubusercontent.com/gjoliveira9634/opencode-agent-foundry/main/assets/logo-light.svg" alt="Agent Foundry" width="380">
  </picture>
</p>

<p align="center">
  <strong>One orchestrator. A Kanban board. Agents that build in parallel.</strong><br>
  An <a href="https://opencode.ai">OpenCode</a> plugin that turns a goal into finished work —
  and shows you the whole thing on a native desktop board.
</p>

<p align="center">
  <a href="https://github.com/gjoliveira9634/opencode-agent-foundry/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/gjoliveira9634/opencode-agent-foundry/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="node" src="https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg">
  <img alt="version" src="https://img.shields.io/badge/version-1.0.0-orange.svg">
</p>

---

You describe an objective. The orchestrator asks what it genuinely needs to know — and only that —
then plans the work onto a Kanban board, dispatches role-based agents to build it in parallel, and
reports what it made. Every task carries its own scope, acceptance criteria and evidence, so
"done" means tests ran and passed, not that a model said so.

<p align="center">
  <img src="https://raw.githubusercontent.com/gjoliveira9634/opencode-agent-foundry/main/assets/screenshots/kanban.png" alt="The Kanban board in the desktop window: tasks with role badges, dependency counts and blockers" width="820">
</p>

## Why this exists

I built a tic-tac-toe app with a multi-agent setup and it consumed **32% of a five-hour
subscription quota**. Not because the work was hard, but because the architecture was wasteful:
every context packet was written into the chat by the orchestrator and read again by the worker, so
the same tokens were billed twice, and every agent got the whole picture whether it needed it or
not.

Agent Foundry is the answer to that bill. Three decisions do most of the work:

**The plugin dispatches roles itself.** It builds each context packet and sends it straight to the
agent through OpenCode's session API. The packet never passes through the orchestrator's output, so
it is paid for once, and the worker receives exactly what the code decided to send instead of a
paraphrase.

**Each role gets a budget and nothing else.** A builder sees one task: its scope, its acceptance
criteria, the command that verifies it. It does not see the plan, the other tasks, or the
conversation. Cheap models do well on small, complete briefs.

**The fixed cost is measured, not assumed.** The orchestrator prompt and every tool description
together cost about **1,400 tokens per turn**, and the smoke test fails if the tool descriptions
grow past their budget. Flow guidance lives in each result's `next` field, which is only paid on the
turn its tool actually runs.

## Install

```jsonc
// opencode.json
{ "plugin": ["opencode-agent-foundry"] }
```

Or point at a local checkout while developing:

```jsonc
{ "plugin": ["/absolute/path/to/opencode-agent-foundry"] }
```

Select the **orchestrator** agent and describe what you want. There is nothing to configure first.

## Choosing the team

Every new conversation opens with one question and two answers: **keep the current setup**, or
**open the window to change it**. Every choice of models happens on that window, because that is the
surface that can show them.

<p align="center">
  <img src="https://raw.githubusercontent.com/gjoliveira9634/opencode-agent-foundry/main/assets/screenshots/setup-teams.png" alt="The setup screen: four vendor teams, each showing the model behind every role" width="820">
</p>

Four vendor teams fill all four roles at once, strongest model on the architecture and the cheap
tier on the builders that run in parallel:

| | architect | lead | analyst | builder |
|---|---|---|---|---|
| **OpenAI** | GPT‑5.6 Sol | GPT‑5.5 | GPT‑5.6 Terra | GPT‑5.6 Luna |
| **Anthropic** | Claude Fable 5.1 | Claude Opus 5 | Claude Sonnet 5 | Claude Haiku 4.5 |
| **Google** | Gemini 3.1 Pro *(preview)* | Gemini 3.8 Flash | Gemini 3.8 Flash | Gemini 3.5 Flash‑Lite |
| **China** | Kimi K3 | Qwen 3.8 Max | GLM 5.3 | DeepSeek V4 Flash |

Each role lists several candidates in descending preference and resolves against the models your
account can actually reach — the same model arrives through a subscription plan for one person and
a first‑party key for another. A role with no reachable candidate says so and falls back to the chat
model rather than writing an id that would fail at dispatch.

Presets are a menu, not a default. With no configuration every role still inherits the model
selected in the chat. `npm run check:presets` holds the table to four rules against OpenCode's own
catalogue: ids must exist, no primary may be an alpha or moving `-latest` build, capability must
never climb from architect to builder, and every pick's age is reported against the newest model its
provider offers.

## Agents are named by role, never by model

An agent is an **organisational role**. A model is the **engine it runs on**. Nothing here couples
the two, and no role has a model baked into the code.

| Role | Scope |
|---|---|
| `orchestrator` | Talks to you, coordinates everything. Always runs on the model selected in the chat. |
| `architect` | Project-wide architecture, sequencing and acceptance. |
| `lead` | One module: contracts and decomposition. |
| `analyst` | One functionality: precise tasks and review. |
| `builder` | One task: implementation, with evidence. |

The orchestrator's definition has **no `model` key at all**, so OpenCode resolves it to whatever you
picked in the chat. Change the model mid-conversation and it follows, with no second setting to keep
in sync.

Rebinding any other role takes effect on the **next dispatch**, with no restart — the model is read
from configuration at the moment the role is called, not frozen when OpenCode started.

## The flow

There is exactly one. No modes, nothing to choose up front.

1. The orchestrator asks whether to keep the current setup or open the window to change it.
2. You describe an objective. It works out what is genuinely unclear.
3. It asks those questions — all at once, numbered — and only about real ambiguity.
4. You answer. Answers become binding decisions the agents may not rewrite.
5. It consults `architect`, `lead` and `analyst` for the shape, each with a distinct scope.
6. Plans become board tasks in one operation, with dependencies resolved.
7. It runs every ready task in parallel, dispatching each builder itself.
8. Completed work passes review gates before it counts as done.
9. When the board is empty, it confirms the objective is met and explains what it built.

The steps are enforced in code, not only in the prompt: a plan cannot be applied while a question is
unanswered, evidence cannot be recorded for work that never started, and a task cannot be reviewed
before it reported evidence. Each refusal names the state the task is actually in and the call that
fixes it.

## The board is the plan

```
BACKLOG → PLANNED → READY → IN_PROGRESS → REVIEW → DONE
                                 ↕
                      BLOCKED · FAILED · CANCELLED
```

State lives in files, so the chat, the CLI and the desktop window always agree:

```
<project>/.agent-foundry/
  project.json      objective, phase, questions, decisions, counters, cost
  tasks/<ID>.json   the source of truth: status, deps, evidence, gates, history
  plans/<ID>.json   planning payloads, kept OUT of project.json
  events.jsonl      append-only audit log
  desktop.json      bridge handshake — exists only while the window is running
```

A task reaches `DONE` only when evidence exists, tests actually ran and passed, and every required
review gate was signed off. An executor saying "done" is not enough.

## The desktop window

A native Tauri window — not a browser tab — showing the board, the dependency graph, the task table,
the live event log and the settings. It talks to the plugin over loopback HTTP with a bearer token
generated per start.

<p align="center">
  <img src="https://raw.githubusercontent.com/gjoliveira9634/opencode-agent-foundry/main/assets/screenshots/dashboard.png" alt="Dashboard: objective, phase, progress, task count, cost and tokens" width="410">
  <img src="https://raw.githubusercontent.com/gjoliveira9634/opencode-agent-foundry/main/assets/screenshots/graph.png" alt="Dependency graph with the critical path highlighted" width="410">
</p>

The desktop layer is **additive**. Delete the binary and everything else still works — the plugin is
fully usable from chat and the CLI with Tauri absent.

Build it once:

```bash
npm run desktop:build     # needs Rust and cargo on PATH
npm run desktop:doctor    # says what is missing and where it looked
```

## Commands

| Command | Does |
|---|---|
| `/foundry <objective>` | Start the flow |
| `/foundry-setup` | Keep the current setup, or open the window to change it |
| `/foundry-board` | The Kanban board |
| `/foundry-status` | Progress, running, blocked, cost |
| `/foundry-next` | Run everything that is ready, in parallel |
| `/foundry-graph [id]` | Dependencies, blast radius, critical path |
| `/foundry-ui` | Open the desktop window |
| `/foundry-help` | What this is and how to drive it |

## Configuration

`agent-foundry.json`, in the project or in `~/.config/opencode/`. Project overrides global. Every
field is optional.

```jsonc
{
  "$schema": "./opencode-agent-foundry.schema.json",

  // Empty or absent = that role uses the model selected in the chat.
  "models": { "architect": "", "lead": "", "analyst": "", "builder": "" },

  "execution": { "max_parallel": 4, "allow_file_overlap": false, "max_retries": 2 },
  // max_parallel: 0 means unlimited — every independent task starts at once.

  // Per-role context budget in tokens — the main cost lever.
  "context": { "architect": 24000, "lead": 16000, "analyst": 12000, "builder": 8000 },

  "desktop": { "enabled": true, "autostart": false, "port": 0 },
  "limits":  { "max_cost_per_task_usd": 0, "max_cost_per_project_usd": 0 },

  // Optional; supplied by you so no vendor pricing is compiled in.
  "pricing": { "<provider>/<model>": { "input_per_1k": 0.001, "output_per_1k": 0.004 } }
}
```

Version 1 config files (with `roles`, `mode`, `max_executors_per_stage`) are migrated on load; the
old `mode` field is dropped because execution modes no longer exist.

## Development

```bash
npm install && npm install --prefix web
npm run verify          # typecheck + backend tests + smoke + web tests + style and preset audits
npm run build           # plugin -> dist/
npm run desktop:build   # the native window
```

`npm run verify` is the gate. Two of its checks exist because a green build proves less than it
looks like it does:

- **`check:styles`** — every `className` in the web app must resolve to real CSS in the built
  bundle. Deleting a stylesheet while its class names stay in the markup produces a passing build,
  a passing test suite, and a completely unstyled screen.
- **`check:presets`** — every preset model id must exist in OpenCode's own catalogue, with no
  unstable primaries and no inverted cost ladder. A wrong id fails at the first dispatch, long after
  anyone would connect it to the preset.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the invariants that are load-bearing, and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for why each one is there.

## License

[MIT](LICENSE) © Gabriel Jose Oliveira
