# Getting started

This guide covers installation, setup verification, and a walkthrough of your first session with
Agent Foundry.

## Prerequisites

- **OpenCode** running on your machine (the AI chat client that hosts plugins)
- **Node.js** version 20 or later
- A project directory to work in

## Installation

Agent Foundry installs as an OpenCode plugin. Two paths are available; choose one.

### Path 1: Via npm (recommended)

Add the plugin to your project's `opencode.json`:

```json
{
  "plugin": ["opencode-agent-foundry"]
}
```

OpenCode installs the plugin automatically and caches it under `~/.cache/opencode/`. You can
optionally include a version suffix (for example, `opencode-agent-foundry@1.0.1`) to pin a
specific release.

### Path 2: From source (for development or when npm is unavailable)

1. Clone the repository and install dependencies:

```bash
git clone https://github.com/gjoliveira9634/opencode-agent-foundry
cd opencode-agent-foundry
npm install
npm install --prefix web
```

2. Build the plugin:

```bash
npm run build
```

3. Reference the checkout in your `opencode.json`. OpenCode treats plugin entries as local paths
when they start with `file://`, `./`, or are absolute paths:

```json
{
  "plugin": ["/absolute/path/to/opencode-agent-foundry"]
}
```

Or with explicit `file://` syntax:

```json
{
  "plugin": ["file:///absolute/path/to/opencode-agent-foundry"]
}
```

On Windows, absolute paths and `file://` URLs work identically.

## Verifying the plugin loaded

1. Restart OpenCode. The plugin should load without errors.

2. In a new chat, run `/foundry-help`. The orchestrator should respond with an overview of the
system and the available commands.

3. The **orchestrator** appears among the selectable agents. If you see it, the plugin is
registered and ready.

## Your first session

This walkthrough covers a complete session: setup, objective, clarification, planning, execution,
and reporting.

### Session setup

Open a new chat and run `/foundry-setup` or `/foundry`. The orchestrator offers two answers:

- **Keep the current setup** — uses the configuration already in place (or defaults if this is a
  new project).
- **Open the Agent Foundry window to change it** — launches the native desktop console on its
  setup screen, where you can choose models for each role and adjust execution settings.

Make your choice. If you choose to open the window and it appears, configure the roles and
settings. When you are done, tell the orchestrator you have finished configuration. The
orchestrator will pick up your choices. If the desktop console does not open (missing binary or
platform support), the orchestrator offers presets in the chat instead.

This question is asked once per conversation, regardless of whether you answer "keep" or
"configure". It is a checkpoint: even if you choose to keep your current setup, you are choosing
it deliberately.

#### Preset resolution

Each preset role resolves to the first candidate model your account can reach. If a role's
candidates are all unavailable on your account, that role inherits your chat model selection.
The setup screen reports which roles are unreachable.

### Stating an objective

After setup, run `/foundry <objective>` or tell the orchestrator your goal in chat. For example:

```
/foundry Migrate the billing service to an event-driven architecture with a zero-downtime cutover.
```

The orchestrator records your objective and moves to clarification.

### Answering clarification questions

The orchestrator asks every genuinely ambiguous question as a single numbered list. For example:

- What is the target deployment window for the cutover?
- Should event consumers maintain the same retry semantics as the current job queue?
- Are there specific compliance constraints on event storage?

Answer each question in your own words. The orchestrator records your answers as binding decisions
that frame the rest of the work.

If nothing is genuinely unclear, the orchestrator says so and proceeds directly to planning.

### The plan

The orchestrator consults the architect for a project-wide strategy, then optionally the lead and
analyst for decomposition by module and functionality. It builds a plan on the Kanban board, which
appears as a table with columns for status and shows every task, its dependencies, and acceptance
criteria.

A plan is ready to execute. Every task has:

- A clear objective
- Acceptance criteria (what must be true when it is done)
- A list of files it may touch
- Its dependencies (tasks that must finish first)
- A priority (1–9)
- An owner (the role that will implement it)

If the plan looks incomplete or you notice a missing step, ask the orchestrator to refine it. The
architect can revise and replan.

### Execution

When you are satisfied with the plan, the orchestrator executes every task that is ready, running
them in parallel (up to the parallelism limit in your configuration). Each builder receives a
context packet with only what it needs: the task title, objective, allowed files, acceptance
criteria, and a verification command.

The orchestrator records each builder's result using `foundry_complete` (when evidence is valid)
or `foundry_fail` (when it is not). Valid evidence consists of changed files and tests that
actually ran and passed. The orchestrator then runs review gates through `foundry_review`,
dispatching the analyst or lead to review against acceptance criteria. The human is consulted
only when the work reaches a checkpoint that requires human judgment—destructive operations,
public contract changes, genuine ambiguity, external dependencies, or conflicting
requirements—and when a task blocks after retries and escalation.

When a builder fails, the engine returns a decision with the failure: retry while the attempt
count is within `execution.max_retries` (default 2), escalate once to the analyst when retries are
exhausted, and block for human input when the task has already been escalated. Each further rung
of the ladder (analyst to lead, lead to architect) is an explicit `foundry_escalate` call recorded
with a reason, never an automatic hop.

### The evidence report

When all tasks finish and all gates pass, the orchestrator confirms with the board and reports
the final status: objectives met, files changed, tests that passed, cost, and token usage.

## Where state lives

Project state is stored in a `.agent-foundry/` directory at your project root. This directory
contains:

- `project.json` — the objective, phase, questions, decisions, and cost summary
- `tasks/<ID>.json` — one file per task with its status, dependencies, evidence, and history
- `plans/<ID>.json` — complete plan records
- `events.jsonl` — an append-only log of every state change
- `desktop.json` — created only while the desktop console is connected; contains the bridge token

You can read these files to inspect state, but never edit them by hand. All changes go through the
`foundry_*` tools or the desktop console.

If you want to start over, delete the `.agent-foundry/` directory. The next time you run
`/foundry`, a new project will be created.

## Opening the desktop console

The Agent Foundry desktop console is optional. Every capability—board views, task management,
configuration—is available from chat and the CLI. The desktop console is a native window that
shows the Kanban board, dependency graph, task details, event log, and settings in a single
visual interface.

### Building the binary

Building the desktop console requires Rust, cargo, and platform-specific build tools:

- **Windows** — Rust, cargo, MSVC build tools, and WebView2 (included with Windows 11)
- **macOS** — Rust, cargo, and Xcode command-line tools
- **Linux** — Rust, cargo, and development libraries: `libwebkit2gtk-4.1-dev libappindicator3-dev
  librsvg2-dev patchelf`

If you installed from source, build the console:

```bash
npm run desktop:build
```

If you see errors about missing dependencies, run:

```bash
npm run desktop:doctor
```

This reports what is missing and provides fix commands.

On Windows, cargo is often absent from Git Bash's PATH. Build from PowerShell and check the
binary timestamp afterward (the Tauri CLI exits 0 even when cargo is missing).

### Downloading a prebuilt binary

Alternatively, download a prebuilt binary from the
[GitHub releases](https://github.com/gjoliveira9634/opencode-agent-foundry/releases):

- Windows: `agent-foundry-desktop-windows-x64.exe`
- macOS: `agent-foundry-desktop-macos-arm64`
- Linux: `agent-foundry-desktop-linux-x64`

After downloading, rename the binary to the name the launcher expects and place it in
`src-tauri/target/release/` inside your plugin's package directory (create the directory if it
does not exist). For an npm install, this is `~/.cache/opencode/opencode-agent-foundry/`; for a
source install, it is your checkout root:

- Windows: `opencode-agent-foundry-desktop.exe`
- macOS: `opencode-agent-foundry-desktop`
- Linux: `opencode-agent-foundry-desktop`

The launcher checks `src-tauri/target/release/` and `src-tauri/target/debug/` in that order.

### Launching the console

Once the binary is available, run `/foundry-ui` in the chat to open the window. The window
connects to the plugin over a local HTTP bridge and syncs state automatically.

Keyboard shortcuts (available on the Kanban page and throughout the console):

- `g` then `d` — Dashboard
- `g` then `k` — Kanban board
- `g` then `g` — Dependency graph
- `g` then `t` — Tasks
- `g` then `e` — Events
- `g` then `s` — Settings
- `/` — Filter
- `?` — Show shortcuts
- `Esc` — Close

## What to read next

- [Agents](agents.md) — understand how the orchestrator delegates work to architect, lead,
  analyst, and builder.
- [Execution model](execution-model.md) — see the complete flow and state transitions.
- [Configuration](configuration.md) — fine-tune model bindings, context budgets, and execution
  behavior.
- [Desktop console](desktop.md) — detailed guide to the window's features and connection.
- [Use cases](use-cases.md) — see Agent Foundry applied to professional work scenarios.
