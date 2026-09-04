# Agent Foundry — complete surface reference

This document covers every slash command, tool, CLI command, HTTP endpoint and state file that
Agent Foundry exposes. All surfaces read and write the same `.agent-foundry/` state directory, so
behavior is consistent whether you work from chat, the desktop console, or the CLI.

## Slash commands

Eight slash commands coordinate the orchestrator flow. They pair with tool definitions that implement
the actual work.

| Command | Purpose |
|---------|---------|
| `/foundry <objective>` | Start a new project or clarify an existing one. Calls `foundry_setup(action="status")`, then `foundry_start` with the objective. Asks for clarification if ambiguous, records answers with `foundry_ask`/`foundry_answer`. |
| `/foundry-setup` | Configure or review the current session. Calls `foundry_setup(action="status")` and offers two choices: keep the current setup, or open the desktop console on the setup screen. If the console cannot open, offers vendor presets in chat instead. |
| `/foundry-board` | Show the Kanban board. Calls `foundry_board(view="markdown")` for a human-readable view and reports what is blocking progress. |
| `/foundry-status` | Summarize the project in one line. Calls `foundry_board(view="summary")` and `foundry_doctor`. Reports objective, phase, progress, running or blocked work, unanswered questions, and cost. Flags every doctor error. |
| `/foundry-next` | Execute everything that is ready. Calls `foundry_execute`, then records each result with `foundry_complete` or `foundry_fail`, runs review gates, and reports the board delta. |
| `/foundry-graph [id]` | Inspect the work graph. Calls `foundry_graph` with `action="validate"` and `"critical_path"` by default, or focuses on a specific task id. Explains dependencies, the critical path, and the blast radius. |
| `/foundry-ui` | Open the Agent Foundry desktop console. Calls `foundry_ui`. If the binary is not built, names the exact build commands. |
| `/foundry-help` | Explain Agent Foundry without calling tools. Covers the five roles, the single flow, and the eight commands. |

## Tools

All 20 tools are prefixed `foundry_` and return compact JSON. Results carry a `next` field
describing the recommended action. Errors are returned as `{ "error": "message" }` and never thrown.

### foundry_setup

**Purpose**: Session configuration — called once per conversation. Asks whether to keep the
current setup or open the configuration screen. Presets and model bindings are applied here.

**Arguments**:

| Argument | Type | Meaning |
|----------|------|---------|
| `action` | `"status" \| "apply"` | `"status"` reports the current setup; `"apply"` records the answer. |
| `choice` | `"keep" \| "configure" \| "preset" \| "inherit" \| "custom"` | Optional; `"keep"` makes no changes; `"configure"` opens the desktop console; `"preset"` applies a vendor preset; `"inherit"` clears all bindings; `"custom"` applies the supplied models. |
| `preset` | `string` | Preset id (`openai`, `anthropic`, `google`, `china`). Required when `choice="preset"`. |
| `architect`, `lead`, `analyst`, `builder` | `string` | Model id for each role (empty string clears the binding). Optional. |
| `builders` | `number` | Maximum concurrent builders. `0` = unlimited. Optional. |

**Result shape**: With `action="status"`, returns `configured` (boolean), `in_effect` (string
describing the current binding summary), `builders` (number or 0 for unlimited), `ask_now`
(boolean; true on first call in the conversation), and `options` (two choices and guidance).
With `action="apply"` and `choice="configure"`, returns `{ opened: true, url?, next }` (if the
console opened) or `{ opened: false, reason, presets, next }` (if it could not open).
With `action="apply"` and other choices, returns `{ applied, preset?, configured: true,
builders, models, inherited, written_to }` where `models` is the resolved bindings and
`inherited` lists roles inheriting the chat model.

**Next**: `action="status"` offers keep or configure; wait for the answer and apply it. After
apply, continue with planning or execution.

**Refusals**: None.

### foundry_start

**Purpose**: Create the project board and initialize state.

**Arguments**:

| Argument | Type | Meaning |
|----------|------|---------|
| `objective` | `string` | The user's goal in their own words. |

**Result shape**: Returns `created` (boolean; true if the project is new), `objective`, `phase`,
`open_questions` (count of unanswered questions from `foundry_ask`), `tasks` (count), and `next`.

**Next**: If the board is new, identify what is unclear with `foundry_ask`. If it already exists,
use `foundry_status` to see where it stands.

**Refusals**: None.

### foundry_ask

**Purpose**: Record ambiguities that must be clarified before planning.

**Arguments**:

| Argument | Type | Meaning |
|----------|------|---------|
| `questions` | `Array<{ question: string; why: string }>` | Each question is what needs answered; `why` explains how the answer changes the work. |

**Result shape**: Returns `asked` (array of `id` and `question`), the count of `open_questions`,
and `next`.

**Next**: Present the questions as a numbered list and wait for answers. Record them with
`foundry_answer`.

**Refusals**: None.

### foundry_answer

**Purpose**: Record the human's replies to questions, which become binding decisions.

**Arguments**:

| Argument | Type | Meaning |
|----------|------|---------|
| `answers` | `Array<{ id: string; answer: string }>` | Question id and the human's reply. |

**Result shape**: Returns `applied` (array of answered question ids), `unknown` (ids that do not
exist), remaining `open_questions` count, current `phase`, and `next`.

**Next**: When all questions are answered, phase changes to PLANNING. Consult roles on
architecture, then plan.

**Refusals**: None.

### foundry_consult

**Purpose**: Ask a reasoning role (architect, lead, or analyst) a question and get its answer
back. The plugin builds the context packet and dispatches the role on its configured model.

**Arguments**:

| Argument | Type | Meaning |
|----------|------|---------|
| `role` | `"architect" \| "lead" \| "analyst"` | Which role to consult. |
| `brief` | `string` | What you need decided, in one or two sentences. |
| `task` | `string` | Optional task id to focus on. |

**Result shape**: Returns `role`, `ok` (boolean), `answer` (the role's response text), `model`
(the model that answered), `estimated_tokens`, and optional `context_truncated` or `error`.

**Next**: Use the answer to shape your plan. Record it with `foundry_plan`.

**Refusals**: None (the role may decline to answer; check `ok`).

### foundry_plan

**Purpose**: Record a plan from a reasoning role. Creates no tasks; planning is separate from
execution. Each author should have a distinct scope so proposals do not overlap.

**Arguments**:

| Argument | Type | Meaning |
|----------|------|---------|
| `author` | `"architect" \| "lead" \| "analyst"` | Which role wrote this plan. |
| `scope` | `string` | The scope (e.g., "billing module", "auth flow"). |
| `summary` | `string` | Concise summary of the plan. |
| `proposals` | `Array<PlanProposal>` | Tasks to create. See table below. |
| `risks` | `string[]` | Optional risks or caveats. |
| `open_questions` | `string[]` | Optional unresolved issues. |

**Proposal schema**:

| Field | Type | Meaning |
|-------|------|---------|
| `title` | `string` | Short task title. |
| `objective` | `string` | What must be true when done. |
| `module` | `string` | Optional scope (e.g., "billing"). |
| `functionality` | `string` | Optional functionality area (e.g., "event publishing"). |
| `allowed_files` | `string[]` | Optional; the only paths the builder may touch (glob patterns supported). |
| `acceptance_criteria` | `string[]` | Optional verifiable conditions for completion. |
| `verification` | `string` | Optional command that proves it works. |
| `depends_on` | `string[]` | Optional dependency: existing task ids or `ref` handles from this plan. |
| `ref` | `string` | Optional local handle so proposals in the same batch can depend on each other. |
| `priority` | `number` | Optional; 1 (low) to 9 (high), default 5. |
| `owner` | `string` | Optional role or name. Defaults to the plan author. |

**Result shape**: Returns `plan` (id), `proposals` (count), `risks` (count), `open_questions`,
optional `unapplied_plans` (warning of earlier plans still sitting idle), and `next`.

**Next**: Apply the plan with `foundry_apply_plan` when the scope is settled.

**Refusals**: Warns if earlier plans from the same conversation remain unapplied.

### foundry_apply_plan

**Purpose**: Turn a plan into board tasks in one atomic operation. Resolves internal `ref`
handles to task ids and checks for missing dependencies.

**Arguments**:

| Argument | Type | Meaning |
|----------|------|---------|
| `plan` | `string` | Plan id (e.g., `PLAN-001`). |
| `prefix` | `string` | Optional; prefix for task ids (default `TASK`). |

**Result shape**: Returns `plan` (id), `created` (array of `id`, `title`, `depends_on`),
optional `warnings` (unknown dependencies, file overlaps), and `next`.

**Next**: Run `foundry_doctor` to validate the board, fix every error, then `foundry_execute`.

**Refusals**: Refuses if any questions remain unanswered.

### foundry_execute

**Purpose**: Run every task that the scheduler says may start, up to the configured builder
count. The plugin dispatches each builder with its own context packet and returns their
results. Parallelism is real and handled in code, not through chat turns.

**Arguments**: None.

**Result shape**: Returns `started` (array of task ids), `results` (array of one per started
task with `ok`, `answer`, `model`, `estimated_tokens`, optional `error`), `running` (total in
progress), `limit` (maximum builders), and `next`.

**Next**: For each successful result, record evidence with `foundry_complete`, then run review
gates.

**Refusals**: Refuses if the project is still CLARIFYING or PLANNING.

### foundry_next

**Purpose**: Ask the scheduler what may start now, without running anything. Respects
dependencies, the builder count ceiling, and file locks.

**Arguments**: None.

**Result shape**: Returns `started` (array of task ids that are already running or just started),
`ready` (every candidate whose dependencies are satisfied), `running` (count), `limit`
(parallelism ceiling), `deferred` (waiting for dependencies or file locks), optional
`awaiting_review`, `failed`, `blocked`, and `next`.

**Next**: If `started` is non-empty, use `foundry_execute`. Otherwise, resolve blockers,
failures, or reviews.

**Refusals**: Refuses if nothing is executable yet (project still CLARIFYING or PLANNING).

### foundry_complete

**Purpose**: Record a finished task with evidence. Rejected unless files changed, tests actually
ran, and tests passed. Moves the task to REVIEW (if valid) or FAILED (if validation rejects).

**Arguments**:

| Argument | Type | Meaning |
|----------|------|---------|
| `id` | `string` | Task id. |
| `actor` | `string` | Optional; who is reporting (defaults to "orchestrator"). |
| `files_created` | `string[]` | Optional; paths created. |
| `files_modified` | `string[]` | Optional; paths modified. |
| `files_deleted` | `string[]` | Optional; paths deleted. |
| `commands_executed` | `string[]` | Optional; commands run. |
| `tests_executed` | `string[]` | Optional; test commands actually run. |
| `test_result` | `"pass" \| "fail" \| "unknown"` | Optional; outcome of tests. |
| `output_summary` | `string` | Optional; summary of output (truncated to 1,200 chars). |

**Result shape**: Returns `id`, `status`, `ok` (whether validation passed), optional `reasons`
(validation failures), `pending_gates` (gates still pending), `cost_usd`, optional
`cost_warning`, and `next`.

**Next**: If valid, run review gates with `foundry_review`. Otherwise, fix the reasons and retry
or escalate.

**Refusals**: Refuses if the task is not IN_PROGRESS.

### foundry_fail

**Purpose**: Record a failed attempt without evidence. Returns whether to retry, escalate, or
block.

**Arguments**:

| Argument | Type | Meaning |
|----------|------|---------|
| `id` | `string` | Task id. |
| `error_summary` | `string` | What went wrong. |
| `actor` | `string` | Optional; who is reporting. |

**Result shape**: Returns `id`, `status` (set to FAILED), `attempts` (count), `decision`
(`"retry"`, `"escalate"`, or `"block"`), `decision_reason`, and `next`.

**Next**: Based on `decision`, retry, escalate with `foundry_escalate`, or wait for human input.

**Refusals**: Refuses if the task is not IN_PROGRESS.

### foundry_review

**Purpose**: Decide one review gate. Passing all required gates marks the task DONE and unblocks
dependents. Rejecting returns the task to IN_PROGRESS.

**Arguments**:

| Argument | Type | Meaning |
|----------|------|---------|
| `id` | `string` | Task id. |
| `gate` | `"execution" \| "test" \| "review" \| "architecture" \| "acceptance"` | Which gate to decide. |
| `decision` | `"passed" \| "rejected"` | The decision. |
| `reviewer` | `string` | Who decided. |
| `note` | `string` | Optional; reason for rejection. |

**Result shape**: Returns `id`, `status`, `pending_gates` (remaining gates), optional
`unblocked` (tasks now ready), and a `next` hint.

**Next**: Continue reviewing pending gates or confirm all are passed.

**Refusals**: Refuses if the task is not in REVIEW status.

### foundry_escalate

**Purpose**: Escalate a failing task from one role to the next level (builder → analyst → lead →
architect) with a recorded reason, instead of retrying.

**Arguments**:

| Argument | Type | Meaning |
|----------|------|---------|
| `id` | `string` | Task id. |
| `from` | `string` | Which role is escalating. |
| `reason` | `string` | Why escalation is needed. |

**Result shape**: Returns `id`, `status` (set to BLOCKED), `escalated_to` (the target role),
and `next`.

**Next**: Delegate the decision to the escalated role.

**Refusals**: None.

### foundry_board

**Purpose**: Retrieve the current board. Three views available: `"summary"` for a high-level
status, `"board"` for all tasks by column, `"markdown"` for a human-readable board.

**Arguments**:

| Argument | Type | Meaning |
|----------|------|---------|
| `view` | `"summary" \| "board" \| "markdown"` | Optional; defaults to `"summary"`. |

**Result shape**: With `view="summary"`, returns project `status()` (objective, phase, cost,
running, blocked, critical path, progress); if there is no project, returns `{ initialized:
false, hint: "..." }`. With `view="board"` or `view="markdown"`, returns structured task
columns or `markdown` (a string for display).

**Next**: For status, report blockers or next steps. For board, explain progress. For markdown,
display it.

**Refusals**: With no project, `summary` returns `initialized: false` (not a refusal).
`board` and `markdown` throw "Foundry is not initialised here".

### foundry_task

**Purpose**: Retrieve one task, or patch it. Without arguments, shows the task summary. With
`detail=true`, includes history, evidence, and escalation. Pass fields to change the task
(status, priority, owner, dependencies, acceptance criteria, anchors).

**Arguments**:

| Argument | Type | Meaning |
|----------|------|---------|
| `id` | `string` | Task id. |
| `detail` | `boolean` | Optional; if true, includes history and evidence. |
| `status` | `TaskStatus` | Optional; move to BACKLOG, PLANNED, READY, IN_PROGRESS, REVIEW, BLOCKED, FAILED, DONE, or CANCELLED. |
| `priority` | `number` | Optional; 1–9. |
| `blocked_reason` | `string` | Optional; reason for BLOCKED status. |
| `owner` | `string` | Optional; role or name. |
| `acceptance_criteria` | `string[]` | Optional; replace all criteria. |
| `depends_on` | `string[]` | Optional; replace all dependencies. |
| `anchors` | `string[]` | Optional; immutable values (human decisions). |

**Result shape**: With no patch, returns the task summary: `id`, `title`, `status`, `priority`,
`owner`, `executor`, `module`, `functionality`, `attempts`, `depends_on`, `blocked_by`,
`blast_radius`, `updated_at`, plus `objective`, `allowed_files`, `acceptance_criteria`,
`verification`, `anchors`, `gates` (as `gate:status` strings), `error_summary`, `upstream`,
`downstream`. With `detail=true`, adds `history` (capped at 3 attempts) and `evidence`. Patching
returns the new `status`, `also_changed` (dependent tasks moved by the patch).

**Next**: For show, inspect upstream/downstream or review gates. For patch, continue with
execution or review.

**Refusals**: Refuses to move a task to READY or IN_PROGRESS with unmet dependencies, or to
rewrite or remove an anchored acceptance criterion or remove anchors. Refusals return
`{ refused: true, reason, next }`. The fields `id`, `created_at`, and `history` cannot be patched.

### foundry_tasks

**Purpose**: List task summaries, optionally filtered by status or module.

**Arguments**:

| Argument | Type | Meaning |
|----------|------|---------|
| `status` | `string` | Optional; filter by task status (e.g., `"IN_PROGRESS"`). |
| `module` | `string` | Optional; filter by module name. |
| `limit` | `number` | Optional; maximum count (default 100). |

**Result shape**: Returns `total` (matching count), `tasks` (array of summaries), optional
`truncated` (count not shown).

**Next**: Inspect tasks with `foundry_task` or review grouped by status.

**Refusals**: Refuses if the project is not initialized.

### foundry_graph

**Purpose**: Query the work graph for dependency analysis. Actions include `"show"` (all edges),
`"upstream"` (transitive dependencies of a task), `"downstream"` (transitive dependents),
`"impact"` (blast radius), `"critical_path"` (longest chain), and `"validate"` (check for
cycles, missing dependencies, overlaps).

**Arguments**:

| Argument | Type | Meaning |
|----------|------|---------|
| `action` | `"show" \| "upstream" \| "downstream" \| "impact" \| "critical_path" \| "validate"` | Graph operation. |
| `id` | `string` | Optional; task id for actions that need it (upstream, downstream, impact). |

**Result shape**: Varies by action. `"show"` returns edge count and edges (up to 200). `"validate"`
returns cycles, missing dependencies, warnings. `"critical_path"` returns the longest path.
`"upstream"`/`"downstream"` return the transitive set. `"impact"` returns the blast radius.

**Next**: Use to explain scheduling decisions, identify blockers, or validate the graph.

**Refusals**: Refuses if the project is not initialized.

### foundry_doctor

**Purpose**: Consistency check across the board. Reports cycles, missing dependencies, file
overlaps that will serialize execution, tasks without acceptance criteria, unapplied plans,
and stalled work (IN_PROGRESS for > 30 minutes).

**Arguments**: None.

**Result shape**: Returns `ok` (boolean), `errors` (array), `warnings` (array), `task_count`,
`file_overlaps` (array of `{ a, b, files }`), `tasks_without_acceptance_criteria`, `stalled`
(task ids).

**Next**: Fix every error before executing. Address warnings to reduce waste.

**Refusals**: None.

### foundry_events

**Purpose**: Recent audit-log entries for explaining what happened and when.

**Arguments**:

| Argument | Type | Meaning |
|----------|------|---------|
| `limit` | `number` | Optional; maximum entries (default 30). |

**Result shape**: Returns array of events with `type`, `at` (ISO timestamp), `actor`, `message`,
optional `task` (id), and optional `data` (context).

**Next**: Inspect for timeline context or escalation decisions.

**Refusals**: None.

### foundry_ui (desktop only)

**Purpose**: Open the Agent Foundry desktop console. Reuses an existing window if already open.

**Arguments**: None.

**Result shape**: Returns `status` (one of `"opened"`, `"reused"`, `"disabled"`, `"unavailable"`,
`"error"`), optional `url` (the bridge endpoint), optional `detail` (error message).

**Next**: Tell the user the window is open, or explain why it failed.

**Refusals**: None.

## CLI

The `agentfoundry` command-line interface reads and writes the same `.agent-foundry/` state.
Default command is `status`.

### Command syntax

```bash
agentfoundry <command> [options]

# Global flags
--dir <path>      Project directory (default: current directory)
--json            Output as JSON instead of formatted text
```

### Commands

| Command | Flags | Output |
|---------|-------|--------|
| `init "<objective>"` | `--dir` | Creates `.agent-foundry/` and initializes state. Returns project summary. |
| `status` | `--dir`, `--json` | Project status: phase, progress, cost, tasks, critical path. Text is markdown. |
| `board` | `--dir`, `--json` | Kanban board by column. JSON shows task ids and summaries. |
| `tree` | `--dir` | Module → functionality → task outline with status markers. Text only. |
| `tasks` | `--dir`, `--status <S>`, `--module <M>` | List tasks, optionally filtered by status or module. |
| `task <ID>` | `--dir`, `--detail` | Show one task. `--detail` includes history and evidence. |
| `graph` | `--dir`, `--focus <ID>`, `--mode {show\|upstream\|downstream\|impact\|critical\|validate}` | Graph query. Default mode is `show` (ASCII art by default; `--json` for structured). |
| `next` | `--dir` | Scheduler decision without running. |
| `doctor` | `--dir`, `--json` | Health check. Sets exit code 1 on errors. |
| `events` | `--dir`, `--limit <N>` | Recent audit-log entries (default 30). |
| `models` | `--dir`, `--set <ROLE=MODEL>` | Show the current model bindings, or bind a model to a role. `--set architect=anthropic/claude-sonnet-5` persists the binding to the project config file; empty model clears it. One role per call. |

### Example output shapes

**`agentfoundry status --json`**: Matches `foundry_board` with `view="summary"` — contains
objective, phase, totals, running, blocked, open\_questions, critical\_path, progress, cost\_usd,
tokens, plans.

**`agentfoundry board --json`**: Matches `foundry_board` with `view="board"` — contains
columns (status → task\_ids), tasks (summaries), totals.

**`agentfoundry graph --json --focus TASK-001 --mode upstream`**: Returns edges, the focus task,
upstream dependencies, critical path.

Exit code 0 on success; 1 when the project is not initialized (except `init` and `status`,
which succeed in an uninitialized state) or on doctor errors. Every command except `init` and
`status` exits 1 with "Agent Foundry is not initialised in <dir>" when there is no project.

## Bridge API

The desktop bridge is a loopback-only HTTP server on `127.0.0.1:<port>` that the desktop
window talks to. All requests (except `/api/health`) require a bearer token generated per bridge
start and read from `.agent-foundry/desktop.json`.

**Protocol version**: 3.

### Authentication and security

- Binds `127.0.0.1` exclusively; never reachable off the machine.
- All requests carry a bearer token in the `Authorization` header (`Bearer <token>`).
- The token is compared in constant time to prevent timing attacks.
- CORS is restricted to Tauri WebView origins and loopback. Preflight (OPTIONS) is answered
  before auth so CORS negotiation succeeds.
- Handshake file (`.agent-foundry/desktop.json`) is written 0600 and deleted on stop.

### Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/health` | No | Liveness check without token. Returns `{ ok: true, protocol: <version> }`. |
| `GET` | `/api/project` | Yes | Project summary. Returns `ProjectSummary` (objective, phase, progress, cost). |
| `GET` | `/api/board` | Yes | Kanban board. Returns `Board` (columns, task summaries, totals). |
| `GET` | `/api/tasks` | Yes | Task list. Query params: `?status=<S>&module=<M>` (filters; omit for all). Returns `{ total, tasks, truncated }`. |
| `GET` | `/api/tasks/:id` | Yes | One task with full detail. Returns `Task` (history, evidence, gates). |
| `GET` | `/api/graph` | Yes | Work graph. Returns `GraphView` (edges, critical path, cycles, missing deps, order). |
| `GET` | `/api/events` | Yes | Audit log. Query param: `?limit=<N>` (default 50). Returns array of `FoundryEvent`. |
| `GET` | `/api/doctor` | Yes | Health check. Returns `DoctorReport` (ok, errors, warnings, overlaps, stalled). |
| `GET` | `/api/config` | Yes | Configuration view. Returns `ConfigView` (source files, models, execution, desktop, limits). |
| `GET` | `/api/runtime` | Yes | Complete setup info. Returns `RuntimeView` (config + catalog, presets, active preset, builders). |
| `POST` | `/api/setup` | Yes | Apply setup choice. Body: `ApplySetupRequest` (choice, preset?, models?, builders?). Returns `RuntimeView`. |
| `POST` | `/api/config/model` | Yes | Bind a model to a role. Body: `{ role: Role, model: string }`. Returns `{ role, model, written_to }`. Empty model clears the binding. |
| `POST` | `/api/questions/answer` | Yes | Answer one question. Body: `{ id: string, answer: string }`. Returns answer summary. |
| `PATCH` | `/api/tasks/:id` | Yes | Update task. Body: `{ status?, priority?, blocked_reason? }`. Returns `{ id, status, also_changed? }`. |
| `GET` | `/api/stream` | Yes | Server-sent events. Returns stream of `StreamFrame` (hello, event, invalidate, ping). |

### Request/response types

**`ApplySetupRequest`** (POST /api/setup body):

```
{
  choice: "keep" | "configure" | "inherit" | "preset" | "custom",
  preset?: string,
  models?: { architect?, lead?, analyst?, builder? },
  builders?: number
}
```

**`SetModelRequest`** (POST /api/config/model body):

```
{
  role: "architect" | "lead" | "analyst" | "builder",
  model: string (empty to clear binding)
}
```

**`AnswerQuestionRequest`** (POST /api/questions/answer body):

```
{
  id: string (question id),
  answer: string
}
```

**`UpdateTaskRequest`** (PATCH /api/tasks/:id body):

```
{
  status?: TaskStatus,
  priority?: number,
  blocked_reason?: string
}
```

### Server-sent event frames (GET /api/stream)

The SSE stream sends frames in JSON format. Ping is sent every 25 seconds; a client treating 70
seconds of silence as disconnection will reconnect and re-resolve address and token.

| Frame type | Body |
|-----------|------|
| `hello` | `{ type: "hello", protocol: number, directory: string }` |
| `event` | `{ type: "event", event: FoundryEvent }` |
| `invalidate` | `{ type: "invalidate", scopes: Array<"board" \| "project" \| "graph" \| "config" \| "events"> }` — tells the client to refresh these caches. |
| `ping` | `{ type: "ping", at: string }` |

### Error responses

All error responses are JSON with an `error` field and optional `detail`:

```
{
  error: "unauthorized" | "not found" | "internal error" | "origin not allowed" | "not configurable",
  detail?: string
}
```

Status codes: 200 (success), 204 (no content for OPTIONS preflight), 400 (bad request —
attempted to bind the orchestrator), 401 (unauthorized), 403 (origin not allowed), 404
(not found, with path in `detail`), 500 (server error).

## State files

All state lives in `.agent-foundry/` and is written atomically (write-then-rename). The store
caches project.json in memory during a bulk operation so it is written once instead of per-task.

### `.agent-foundry/project.json`

**Purpose**: Project metadata and planning summary.

**Fields**:

- `project_id` (string) — unique id (e.g., `"FOUNDRY-001"`).
- `objective` (string) — the cleaned objective.
- `phase` (string) — current phase: `CLARIFYING`, `PLANNING`, `EXECUTING`, `REVIEWING`, or
  `DONE`.
- `status` (string) — `"active"`, `"paused"`, or `"completed"`.
- `counters` (object) — used for generating ids (e.g., `{ TASK: 5 }`).
- `plans` (array) — compact plan refs (see below). Full plans live in `plans/<ID>.json`.
- `questions` (array) — asked questions with optional `answer`, `answered_at`.
- `human_decisions` (array) — binding decisions recorded from answers.
- `acceptance_anchors` (array) — immutable acceptance criteria (frozen human decisions).
- `cost_totals_usd` (number) — cumulative cost of all completed tasks.
- `tokens_total` (number) — cumulative tokens (input + output).
- `created_at`, `updated_at` (ISO strings).

**Compact plan ref** (in `plans` array):

```
{
  id: string,
  author: string,
  scope: string,
  proposals: number (count),
  applied: boolean,
  at: ISO string
}
```

### `.agent-foundry/tasks/<ID>.json`

**Purpose**: Authoritative task state. Source of truth for the board.

**Fields**:

- `id`, `title`, `objective` (strings).
- `module`, `functionality` (optional strings — scope levels).
- `status` (one of: `BACKLOG`, `PLANNED`, `READY`, `IN_PROGRESS`, `REVIEW`, `BLOCKED`,
  `FAILED`, `DONE`, `CANCELLED`).
- `priority` (1–9; default 5).
- `owner`, `executor` (role or name).
- `depends_on`, `blocks`, `related_to` (arrays of task ids).
- `parent_task`, `child_tasks` (optional; task hierarchy).
- `allowed_files` (array; glob patterns the builder may touch).
- `acceptance_criteria` (array; verifiable conditions).
- `verification` (optional; command that proves it works).
- `anchors` (array; immutable criteria).
- `attempts` (count; incremented on each attempt).
- `history` (array, capped at 3; recent attempts with result, error, evidence).
- `evidence` (optional; files, commands, tests, output from completion).
- `review_gates` (array of `{ gate, status, reviewer, at, note }`; gates: execution, test,
  review, architecture, acceptance).
- `error_summary`, `blocked_reason` (optional strings).
- `escalation` (optional; `{ from, to, reason, at }`).
- `tokens_estimated`, `cost_estimated_usd` (optional; estimated task cost).
- `created_at`, `updated_at` (ISO strings).

### `.agent-foundry/plans/<ID>.json`

**Purpose**: Full planning payload. Kept separate so project.json stays small.

**Fields**:

- `id`, `author`, `scope`, `summary` (strings).
- `proposals` (array of proposal objects; see `foundry_plan` arguments).
- `risks`, `open_questions` (arrays; optional).
- `applied` (boolean).
- `applied_task_ids` (array of task ids created from this plan).
- `at` (ISO string; when the plan was submitted).

### `.agent-foundry/events.jsonl`

**Purpose**: Append-only audit log. One event per line, JSON format.

**Fields per event**:

- `seq` (number; sequence for cache tracking).
- `type` (see event types below).
- `at` (ISO string; when the event occurred).
- `actor` (role or name; who caused it).
- `message` (human-readable description).
- `task` (optional; task id if the event concerns a task).
- `data` (optional; structured context; e.g., `{ from: "FAILED", to: "REVIEW" }`).

### `.agent-foundry/desktop.json`

**Purpose**: Bridge handshake. Written only while the desktop bridge is running.

**Fields**:

- `protocol` (number; protocol version).
- `url` (string; `http://127.0.0.1:<port>`).
- `token` (string; bearer token for requests).
- `directory` (string; absolute path of the project).
- `pid` (number; process id).
- `started_at` (ISO string).

**Permissions**: 0600 (owner-only); deleted when the bridge stops.

## Event types

Every event is logged to `events.jsonl` with a type, timestamp, actor, and message.

| Type | When emitted | Common data |
|------|--------------|-------------|
| `PROJECT_CREATED` | On `foundry_start` when creating a new project. | — |
| `PROJECT_UPDATED` | When project metadata changes (objective updated, setup applied, model bound). | `{ models?, builders?, preset? }` |
| `PHASE_CHANGED` | When the project phase changes. | `{ from, to }` |
| `QUESTION_ASKED` | On `foundry_ask` for each question. | `{ id }` |
| `QUESTION_ANSWERED` | On `foundry_answer` for each reply. | `{ id }` |
| `PLAN_SUBMITTED` | On `foundry_plan`. | `{ plan: id }` |
| `PLAN_APPLIED` | On `foundry_apply_plan`. | `{ plan: id }` |
| `TASK_CREATED` | On `foundry_apply_plan` for each task. | — |
| `TASK_UPDATED` | On `foundry_task` when patching fields (except status). | — |
| `TASK_STATUS_CHANGED` | When a task status changes (manual patch, dependency unblocking, etc.). | `{ from, to }` |
| `TASK_STARTED` | On `foundry_execute` when a task enters IN_PROGRESS. | — |
| `TASK_COMPLETED` | On `foundry_complete` when evidence is accepted. | `{ gates: required_gate_names }` |
| `TASK_FAILED` | On `foundry_complete` when evidence is rejected, or `foundry_fail`. | `{ decision: "retry" \| "escalate" \| "block" }` |
| `TASK_BLOCKED` | When a task moves to BLOCKED (dependencies unmet, manual block, escalation). | — |
| `TASK_UNBLOCKED` | When a task moves from BLOCKED/PLANNED to READY (dependencies satisfied). | — |
| `REVIEW_DECIDED` | On `foundry_review` for each gate decision. | `{ gate: name }` |
| `ESCALATION_RAISED` | On `foundry_escalate`. | `{ from, to }` |
| `COST_RECORDED` | On `foundry_complete` after cost estimation. | `{ cost, input, output }` |
| `SCHEDULER_DECISION` | On `foundry_next` or `foundry_execute` after schedule computation. | `{ started: ids, ready: count }` |
| `DESKTOP_OPENED` | When the desktop console opens. | — |
| `DESKTOP_CLOSED` | When the desktop console closes. | — |

All events carry actor (role or name), timestamp, and optional task id. Desktop events are
informational; others drive the state machine.
