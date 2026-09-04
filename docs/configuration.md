# Configuration reference

Agent Foundry reads configuration from the project directory and an optional global
location, applies defaults, and validates the result against a JSON Schema. This
document covers every field, how configuration is resolved and persisted, and the
migration path from earlier versions.

## File locations and precedence

Configuration is loaded in this order; later values override earlier ones:

1. **Defaults** — built into the plugin
2. **Global** — `$OPENCODE_CONFIG_DIR` or `~/.config/opencode/`, looking for
   `agent-foundry.json` or `opencode-agent-foundry.json`
3. **Project** — the project directory, looking for `agent-foundry.json`,
   `agent-foundry.jsonc`, or `.opencode/agent-foundry.json` (in that order)

The first project file found is used; the others are ignored. A malformed file (invalid
JSON or a parse error) is skipped silently and does not prevent the plugin from loading.

### Whole-line comments in .jsonc files

Files with the `.jsonc` extension support whole-line `//` comments:

```jsonc
{
  "models": {
    // OpenAI models for this project
    "architect": "openai/gpt-5.6-sol"
  }
}
```

The comment stripping is simple: any line whose leading whitespace is followed by `//`
is dropped entirely. Comments must occupy the whole line; inline comments are not
supported.

### Environment variable `OPENCODE_CONFIG_DIR`

Overrides the global config directory. If set, Agent Foundry looks for
`agent-foundry.json` or `opencode-agent-foundry.json` in that directory instead of
`~/.config/opencode/`.

## Configuration fields reference

All fields are optional. Omitted fields use their defaults.

### Root level

| Field | Type | Default | Constraints | Meaning |
|-------|------|---------|-------------|---------|
| `version` | number | 2 | always 2 | Config format version. Version 1 files are migrated on load. Do not set by hand. |
| `configured` | boolean | false | — | Set by the setup flow when a human has explicitly chosen a configuration. Never set by hand-editing defaults. The desktop uses this to decide whether to show onboarding. |
| `models` | object | `{}` | — | Per-role model bindings (see below). |
| `execution` | object | (defaults below) | — | Parallelism and retry policy. |
| `context` | object | (defaults below) | — | Per-role token budgets. |
| `desktop` | object | (defaults below) | — | Desktop console settings. |
| `limits` | object | (defaults below) | — | Spend ceilings. |
| `pricing` | object | `{}` | — | Optional price table for cost estimation. |

### Models: per-role LLM bindings

Under `models`, each role is optional:

| Field | Type | Default | Constraints | Meaning |
|-------|------|---------|-------------|---------|
| `models.architect` | string | `""` | opaque model id | Model for the architect role. Empty = inherit the chat model. |
| `models.lead` | string | `""` | opaque model id | Model for the lead role. Empty = inherit the chat model. |
| `models.analyst` | string | `""` | opaque model id | Model for the analyst role. Empty = inherit the chat model. |
| `models.builder` | string | `""` | opaque model id | Model for the builder role. Empty = inherit the chat model. |

Model ids are understood by OpenCode and typically follow the pattern `<provider>/<model>` (for
example, `anthropic/claude-sonnet-5`). The orchestrator cannot be bound; it always uses the
chat model.

### Execution settings

Under `execution`:

| Field | Type | Default | Constraints | Meaning |
|-------|------|---------|-------------|---------|
| `execution.max_parallel` | number | 4 | ≥ 0, integer | How many tasks may run concurrently. 0 = unlimited: the scheduler starts everything whose dependencies and file locks allow. No upper cap. |
| `execution.allow_file_overlap` | boolean | false | — | When false, two tasks declaring overlapping files never run at the same time. |
| `execution.max_retries` | number | 2 | 0–10 | How many times a task may retry after a failure before escalating to a higher role. |

### Context budgets

Under `context`, the token budget per role:

| Field | Type | Default | Constraints | Meaning |
|-------|------|---------|-------------|---------|
| `context.architect` | number | 24000 | ≥ 1000 | Maximum tokens in the execution packet sent to the architect. |
| `context.lead` | number | 16000 | ≥ 1000 | Maximum tokens in the execution packet sent to the lead. |
| `context.analyst` | number | 12000 | ≥ 1000 | Maximum tokens in the execution packet sent to the analyst. |
| `context.builder` | number | 8000 | ≥ 1000 | Maximum tokens in the execution packet sent to the builder. |

When a packet exceeds its budget, it is trimmed on a line boundary and marked truncated.
Budgets are the main lever on cost: lowering them reduces what each role sees and costs
per delegation.

### Desktop console settings

Under `desktop`:

| Field | Type | Default | Constraints | Meaning |
|-------|------|---------|-------------|---------|
| `desktop.enabled` | boolean | true | — | Whether the desktop console is available. When false, `/foundry-ui` and `foundry_ui` are disabled. |
| `desktop.autostart` | boolean | false | — | Start the bridge when the plugin loads instead of on first UI request. |
| `desktop.port` | number | 0 | 0–65535 | The port the bridge binds to. 0 = OS picks an ephemeral port (recommended). Always bound to 127.0.0.1. |

### Spend ceilings

Under `limits`:

| Field | Type | Default | Constraints | Meaning |
|-------|------|---------|-------------|---------|
| `limits.max_cost_per_task_usd` | number | 0 | ≥ 0 | Maximum cost in USD for one task execution. 0 = no limit. |
| `limits.max_cost_per_project_usd` | number | 0 | ≥ 0 | Maximum cost in USD for the entire project. 0 = no limit. |

When a cost estimate would exceed a limit, a `cost_warning` is included in the completion
result for the orchestrator to review. Cost is estimated from tokens and the `pricing`
table.

### Pricing table

`pricing` is a flat object mapping model ids to cost rates:

```json
{
  "pricing": {
    "anthropic/claude-sonnet-5": {
      "input_per_1k": 0.003,
      "output_per_1k": 0.015
    },
    "openai/gpt-5.6-sol": {
      "input_per_1k": 0.001,
      "output_per_1k": 0.004
    }
  }
}
```

Each model id maps to an object with `input_per_1k` and `output_per_1k` (both in USD per
1000 tokens). Unknown models fall back to a generic rate of 0.002 / 0.008 USD per 1k
tokens.

## Session setup: when configuration is written

The first time the orchestrator runs in a conversation, it offers a setup choice.
Four choices write configuration:

- **`keep`** — Marks the project configured without changing any settings. Used when
  existing configuration is already appropriate.
- **`inherit`** — Removes the `models`, `execution`, `context`, and `limits` sections from
  the project file so the defaults apply. All roles then use the chat model, and all other
  settings revert to defaults. Useful for a minimal or fresh configuration.
- **`custom`** — Applies the models and builders supplied. For example:
  `{ choice: 'custom', models: { architect: 'anthropic/claude-opus-5' }, builders: 2 }`.
- **`preset`** — Resolves a vendor preset against the live OpenCode catalogue and writes
  the concrete model bindings. A preset that cannot be resolved writes what it can reach
  and leaves unreachable roles inheriting the chat model.

All choices set `configured` to true, even if no settings changed. This is how the setup
screen knows not to show onboarding on the next conversation.

## Presets: vendor model teams

A preset is a curated team of four models, one per role, optimized for a specific vendor.
Presets are a menu, not a default: nothing here applies until someone picks it. With no
configuration, every role inherits the chat model.

### Available presets

| Preset ID | Display label | Summary |
|-----------|---------------|---------|
| `openai` | OpenAI | GPT-5.6 Sol to plan, 5.5 to decompose, Terra and Luna to execute. |
| `anthropic` | Anthropic | Fable to design, Opus to decompose, Sonnet to specify, Haiku to build. |
| `google` | Google | Gemini Pro for architecture, 3.8 Flash for the rest, Flash-Lite on the builds. |
| `china` | OpenCode Go | Kimi, Qwen, GLM and DeepSeek — one lab per role, through OpenCode Go. |

### Preset resolution

Each preset lists candidate models per role in order of preference. When a preset is
chosen, Agent Foundry resolves it against the live OpenCode catalogue (the models this
account can reach). The first candidate each account can reach is written; if no
candidate is reachable, that role inherits the chat model and is reported as unavailable.

An unavailable role does not cause the preset to fail; it means that role will use the
chat model instead.

### Detecting the active preset

When a project's configuration matches a shipped preset exactly, the desktop console
reports `active_preset` as the preset id. This allows the setup screen to show which
preset was picked, if any.

An unconfigured project (all bindings empty) never matches a preset, even if an
unreachable preset has the same empty bindings.

### Preset audit rules (`check:presets`)

The `npm run check:presets` script validates presets against the OpenCode model
catalogue (if present locally):

- **Ids exist**: each candidate model id must exist in the catalogue.
- **No unstable primaries**: the first candidate per role must not be alpha, beta,
  preview, exp, experimental, free, contributor, nightly, or latest — unless
  explicitly acknowledged with a reason.
- **Ladder descends**: output price per 1000 tokens must not climb from architect to
  builder (lower roles run more frequently and cost more in aggregate). Exceptions are
  acknowledged.

Exceptions are recorded in `ACKNOWLEDGED` in `src/config/presets.ts` with a reason
someone can later disagree with.

## Context budgets in detail

Each role receives a bounded execution packet with the minimal context it needs to
work. The context budget is enforced by trimming at a line boundary if the packet
exceeds it.

### What each packet contains

**Builder** packets are minimal: task id, title, objective, a flat list of allowed file
paths (up to 40), acceptance criteria as a checklist, the verification command,
immutable anchors (if any), a summary of the last failed attempt (if any), and the
evidence instruction. Nothing about other tasks or the conversation.

**Reasoning role** packets (architect, lead, analyst) include: the project objective,
answered questions (up to 12), human decisions, acceptance anchors, the board in scope
(all tasks for architect; same module for lead; same functionality for analyst) with
status counts and up to 15 items needing attention (BLOCKED, FAILED, REVIEW), the focus
task with files and blast radius, and orchestrator notes.

Token estimation uses a rough formula: 4 characters per token.

## Execution settings in detail

### Parallelism: `max_parallel`

- **Value 0**: Unlimited. The scheduler starts every ready task whose dependencies
  are met and whose files are not locked.
- **Value N > 0**: At most N tasks run concurrently.
- **No upper cap**: there is no maximum value. The ceiling that matters is the work
  graph itself.

### File locking: `allow_file_overlap`

When false (default), the scheduler enforces a file lock: if two independent tasks
declare overlapping `allowed_files` globs, the second task waits for the first to
complete before starting. This prevents edit conflicts.

When true, overlapping files can run concurrently; the builders are responsible for
avoiding conflicts (for example, writing to different keys in the same object, or
coordinating through a lock outside Agent Foundry).

The doctor report warns about file overlaps between independent tasks; they serialize
execution even when overlap is allowed.

### Retries: `max_retries`

When a task fails, the builder is retried up to `max_retries` times. After that, the
task escalates to the next level. A task that fails after escalation is blocked for
human input.

## Cost control

### Per-task vs per-project limits

- **`max_cost_per_task_usd`**: Cost limit per task execution. When an estimate would exceed
  this, a `cost_warning` is surfaced in the completion result for the orchestrator to review.
- **`max_cost_per_project_usd`**: Cumulative cost across the entire project. When the project
  total plus a task's estimate would exceed this, a `cost_warning` is surfaced in the
  completion result.

Cost limits are advisory: nothing is refused, stopped, or blocked automatically. The
orchestrator is expected to surface the warning to the human before continuing.

A limit of 0 disables that check.

### Pricing and the fallback rate

Costs are estimated from token counts and the optional `pricing` table. If a model id
is not in the table, a fallback rate is used: **0.002 USD per 1000 input tokens** and
**0.008 USD per 1000 output tokens**. These are illustrative rates; actual costs vary
by model and provider.

### Token estimation

Token counts are rough estimates, not measurements. The estimate for a task's execution
packet is: `(packet character count + history character count) / 4` plus fixed allowances of
1,500 input tokens and 700 output tokens per role.

## Desktop console settings

The desktop console is optional. When disabled, it cannot be opened. The bridge starts
when needed (on first `/foundry-ui`, or if `autostart` is true) and stops when the plugin
stops or is disposed. The window may remain open and show a disconnected state.

### Port and binding

- **`port: 0`** (recommended): The OS picks an ephemeral port. The launcher finds it by
  reading the handshake file (`.agent-foundry/desktop.json`).
- **`port: N > 0`**: The bridge attempts to bind to that port on 127.0.0.1. If it is
  already in use, the bridge fails to start and `/foundry-ui` is disabled.

The bridge is always bound to 127.0.0.1, never exposed to the network. The handshake
file (mode 0600) is the only way to get the token and port.

## Migration from version 1

Version 1 configuration used model names as role keys (`roles.haiku.model` instead of
`models.builder`). On load, Agent Foundry automatically migrates v1 files to v2. The file
is rewritten only on the next settings change (setup or a model binding). This section
documents how the old keys map.

### Model bindings

v1 role keys map to v2 roles by position in the hierarchy:

| v1 key | v1 shape | v2 role | v2 shape |
|--------|----------|---------|----------|
| `roles.fable` | `{ model: "..." }` | `architect` | `models.architect: "..."` |
| `roles.opus` | `{ model: "..." }` | `lead` | `models.lead: "..."` |
| `roles.sonnet` | `{ model: "..." }` | `analyst` | `models.analyst: "..."` |
| `roles.haiku` | `{ model: "..." }` | `builder` | `models.builder: "..."` |

The orchestrator (v1 `roles.luna`) is never bound and is skipped.

### Execution settings

- `max_executors_per_stage` → `execution.max_parallel`
- `roles.haiku.max_retries` → `execution.max_retries`
- `allow_file_overlap` → `execution.allow_file_overlap` (moved from root to nested)

### Other mapped keys

- `cost_limits` → `limits` (keys are copied into `limits` unchanged)

### Dropped keys

These v1-only keys are removed during migration and not written back:

- `mode` — there is only one flow now
- `preset` — stored as concrete bindings instead
- `auto_continue` — removed
- `kanban_statuses` — removed
- `default_mcps`, `default_lcps` — removed

An already-migrated v2 file is never re-migrated. If a v1 file is edited to add v2 keys
alongside v1 keys, the v2 keys are preserved and the v1 ones are dropped.

## Environment variables

| Variable | Meaning |
|----------|---------|
| `OPENCODE_CONFIG_DIR` | Directory for global config files. Defaults to `~/.config/opencode/`. Checked for `agent-foundry.json` or `opencode-agent-foundry.json`. |
| `OPENCODE_MODELS_JSON` | Path to OpenCode's model catalogue (used by `npm run check:presets`). Defaults to `~/.cache/opencode/models.json`. |
| `FOUNDRY_DESKTOP_PROBE` | Set to `1` to enable diagnostic reporting from the desktop shell. |
| `FOUNDRY_PROBE_URL` | URL to send diagnostics to (only read if `FOUNDRY_DESKTOP_PROBE` is set). |
| `FOUNDRY_PROJECT_DIR` | Set by the desktop launcher; the plugin's project directory. |

## Examples

Six example configurations are provided in `examples/`:

- **`minimal.jsonc`** — Inherit everything; the smallest possible config.
- **`per-role.jsonc`** — Bind a different model per role without affecting execution or
  context.
- **`cost-guarded.jsonc`** — Set spending limits and a custom pricing table.
- **`headless.jsonc`** — Desktop console disabled; useful for CI or headless servers.
- **`unlimited-parallel.jsonc`** — Unlimited concurrent task execution.
- **`global.jsonc`** — Placed in the global config directory; applies to all projects
  unless overridden.

Each example is annotated with comments and can be copied to your project or global
config directory. See `examples/README.md` for details.

## JSON schema

The complete schema is at `opencode-agent-foundry.schema.json` in the repository root.
Most editors support JSON Schema validation; configure your editor to use this schema
for files named `agent-foundry.json` or `agent-foundry.jsonc`.

## Troubleshooting

### Configuration is not being read

1. Check the file path: `agent-foundry.json` or `agent-foundry.jsonc` in the project
   root, `<project>/.opencode/`, or `~/.config/opencode/`.
2. Verify the file is valid JSON (or `.jsonc` with only whole-line comments).
3. Restart OpenCode.
4. Check the plugin logs for errors (if any malformed file exists, it is silently
   skipped).

### A model binding is not taking effect

Model bindings are resolved at dispatch time, not at configuration time. If you change
a binding, the next role dispatch will use the new model. No restart is needed.

### Cost limit errors when it should not be limited

1. Check that `limits.max_cost_per_task_usd` and `limits.max_cost_per_project_usd` are
   set to 0 (disabled) or omitted.
2. Verify the `pricing` table if you have one; an unknown model uses the fallback rate.

### A preset reports unreachable roles

One or more roles in the preset have no reachable candidate in the catalogue. That is
not an error; the unavailable roles will inherit the chat model when the preset is
chosen. The setup screen shows a badge on the preset card indicating the count of
unreachable roles, and marks each unavailable role "inherits from chat — not reachable".
The preset is still selectable.
