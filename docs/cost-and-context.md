# Cost and context

Agent Foundry is built around token economics. Every role receives a budgeted context packet scoped
to its job. This document describes how tokens flow through a run, how context packets are composed
per role, how cost is estimated and guarded, and how to tune the configuration for your environment.

## Where tokens go in a run

Each turn of the orchestrator costs a fixed amount: the orchestrator's prompt (approximately 770
tokens) plus the tool descriptions (about 650 tokens) totaling approximately 1,400 tokens.

When a role is dispatched, the cost includes:

- The role's context packet (varies by role and scope).
- The fixed role prompt (architect ≈ 310 tokens; lead ≈ 223; analyst ≈ 258; builder ≈ 289).
- The output tokens the role generates (estimated per dispatch).

The plugin estimates the input and output tokens for each dispatch and records them in the project
state for visibility and cost guards.

### Fixed per-turn cost

The orchestrator's per-turn cost is approximately 1,400 tokens:

| Component | Approximate tokens |
|---|---|
| Orchestrator prompt | 770 |
| Tool descriptions (20 tools) | 650 |
| **Total** | **1,400** |

Tool descriptions are re-sent on every request and dominate the fixed cost. Flow guidance lives
instead in each tool's `next` hint, which is only paid when that tool runs.

## Packet composition per role

Every role receives a scoped packet from `src/context/packet.ts`. The packet is the role's entire
brief — nothing else is sent. This keeps context small and costs predictable.

### Builder packet

A builder receives one task and nothing else:

- Task ID and title
- Objective
- Allowed files (max 40 listed, glob patterns supported)
- Acceptance criteria (as a checklist)
- Verification command (if any)
- Anchors (immutable reference points, max 10 listed)
- Last failure summary (if any previous attempts failed)
- Instruction: report evidence (files touched, commands run, test results)

**Absence:** No project objective, no board, no other tasks, no planning history.

### Reasoning role packets (architect, lead, analyst)

Reasoning roles receive:

- Project objective
- Answered questions (up to 12 most recent)
- Human decisions (binding anchors, max 10 listed)
- Acceptance anchors (max 10 listed)
- Board in scope:
  - Architect: all tasks; status counts; tasks needing attention (BLOCKED/FAILED/REVIEW, max 15)
  - Lead: tasks in the same module; status counts; needs attention
  - Analyst: tasks in the same functionality; status counts; needs attention
- Focus task (if any): ID, title, objective, allowed files (max 20), blast radius (max 12 listed)
- Orchestrator notes (if any, max 10 items)

Each role's scope is progressively smaller: architect sees the project, lead sees one module,
analyst sees one functionality area.

## Budgets and truncation

Each role has a token budget in `config.context.<role>`:

| Role | Default budget | Minimum |
|---|---|---|
| architect | 24,000 | 1,000 |
| lead | 16,000 | 1,000 |
| analyst | 12,000 | 1,000 |
| builder | 8,000 | 1,000 |

The packet is built as text, estimated as characters / 4 (an approximation for token counting),
and trimmed on a line boundary if it exceeds the budget. Truncation is marked in the packet, so
the role knows its context is incomplete.

## Plugin-side dispatch halves relay cost

When the orchestrator delegates, it does not type the packet into chat. Instead:

1. The plugin builds the context packet (`src/context/packet.ts`).
2. The plugin dispatches the role directly through OpenCode's session API
   (`src/runtime/opencode-host.ts`).
3. The packet is sent as the role's prompt, billed once as input tokens.

Compared to relaying through the chat:

- **Relay cost:** packet output tokens (orchestrator) + packet input tokens (role) = **billed twice**.
- **Direct dispatch cost:** packet input tokens (role) = **billed once**.

This saves approximately half the token consumption on packets and ensures the role receives exactly
what the code decided to send, not a paraphrase.

## Compact results and the tool-description budget

Tool results are compact. A tool does not return the full task object; instead it returns:

- A boolean `ok` flag
- A one-line `next` hint (the usual next action for the caller)
- Compact summary fields (IDs, short strings, status counts)
- Optional `detail` with the full payload (opt-in, not re-sent by default)

For example, `foundry_complete` returns:

```json
{
  "id": "TASK-001",
  "status": "REVIEW",
  "ok": true,
  "pending_gates": ["review", "acceptance"],
  "cost_usd": 0.0042,
  "next": "Run the remaining gates with foundry_review."
}
```

Flow narration used to live in tool descriptions (re-sent on every request). Now it lives in the
prompt and in `next` hints, which are paid only when the tool runs. This reduces the 20-tool
description cost to about 650 tokens — enforced by the smoke test.

## Cost estimation and limits

The cost model is deliberately rough. It exists to make cost visible and to trip the configured
guards.

### Estimation functions

`src/orchestration/router.ts` provides:

- `estimateTokensForTask(task)` — rough estimate of input (≈ packet size + 1,500 fixed) and output
  (≈ 700 tokens) for a builder dispatch.
- `estimateCost(config, model, inputTokens, outputTokens)` — USD cost given model and token counts.
- `checkCostLimits(config, taskCost, projectTotal)` — checks `config.limits.max_cost_per_task_usd`
  and `config.limits.max_cost_per_project_usd`.

### Pricing

Pricing is configured in `config.pricing["<provider>/<model>"]`. These are illustrative example rates:

```json
{
  "pricing": {
    "anthropic/claude-sonnet-5": { "input_per_1k": 0.003, "output_per_1k": 0.015 },
    "anthropic/claude-haiku-4-5": { "input_per_1k": 0.0008, "output_per_1k": 0.004 }
  }
}
```

Unknown models fall back to a generic rate: `{ input_per_1k: 0.002, output_per_1k: 0.008 }`.

### Cost guards

Set `limits.max_cost_per_task_usd` and `limits.max_cost_per_project_usd` in configuration. A limit
of 0 disables the guard. Cost limits are advisory: when a task or project exceeds its limit, the
completion result carries a `cost_warning` field naming the limit. The orchestrator is expected to
surface the warning to the human before continuing; nothing is refused, blocked, or stopped
automatically.

## Practical tuning guide

### Cheaper builder tier

To reduce per-task cost, bind the builder to a cheaper model than the reasoning roles. Builders work
on a narrow scope (one task, one objective) and benefit less from larger context than architects do.

Example:

```json
{
  "models": {
    "architect": "anthropic/claude-opus-5",
    "builder": "anthropic/claude-haiku-4-5"
  }
}
```

### Lower builder budget

If builder output is verbose or tasks are failing repeatedly, lower `context.builder`. Start at
6,000 and measure. Builder packets are small by design (one task, no conversation history).

### Parallelism vs file locks

- Set `execution.max_parallel` higher to run more builders at once, which speeds up execution but
  may increase hourly cost.
- If tasks define `allowed_files` carefully and do not overlap, file locks rarely defer work.
- Use `foundry_doctor` to spot tasks that will serialize due to overlapping file scopes.

### Preset ladder rule

Vendor presets follow a price ladder: architect > lead > analyst > builder (in output price). This
ensures cheaper roles handle simpler work. If your chosen models break the ladder (e.g. architect
cheaper than builder), document the reason in a comment.

### When to raise the architect budget

The architect sees the whole project and often produces large plans. If plans are truncated or the
architect requests more context, raise `context.architect` in increments of 4,000 tokens until the
pattern stops.

### Debugging cost surprises

- Run `agentfoundry events` or use the `foundry_events` tool to see every dispatch. Each COST_RECORDED
  event includes the role, estimated input/output tokens, model, and timestamp.
- Use `foundry_graph validate` to spot high-cost patterns (many dependencies, many downstream).
- Run a small project (e.g. 3–5 tasks) with actual models before a large engagement to calibrate
  estimated costs with actual outcomes.
