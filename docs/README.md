# Documentation

Agent Foundry documentation covers setup, operation, configuration, and architecture for
three audiences. Every document stands alone; follow the reading path that matches your goal.

## Complete document list

| Document | Purpose |
|----------|---------|
| [Getting started](getting-started.md) | Prerequisites, installation, and your first session. |
| [Agents](agents.md) | The five-level hierarchy: roles, scopes, and how they collaborate. |
| [Execution model](execution-model.md) | The single flow: setup, clarification, planning, execution, completion. |
| [Configuration](configuration.md) | Every setting: presets, budgets, limits, pricing, environment variables. |
| [Reference](reference.md) | Slash commands, tools, CLI, bridge API, state files, events. |
| [Desktop console](desktop.md) | The native window: features, connection, building the binary, diagnostics. |
| [Architecture](architecture.md) | Design decisions, components, cost model, testing strategy, invariants. |
| [Cost and context](cost-and-context.md) | Token economics, packet composition, budgets, tuning for efficiency. |
| [Use cases](use-cases.md) | Six professional scenarios with decomposition and evidence. |
| [Troubleshooting](troubleshooting.md) | Symptoms, causes, and fixes for common problems and questions. |

## Reading paths

### Evaluating Agent Foundry

Start here if you are deciding whether Agent Foundry fits your workflow.

1. [Getting started](getting-started.md) — prerequisites and installation
2. [Agents](agents.md) — understand the role hierarchy
3. [Use cases](use-cases.md) — see it applied to professional work
4. [Architecture](architecture.md) — review design decisions and invariants
5. [Cost and context](cost-and-context.md) — understand token economics

### Operating a project

Start here if you have Agent Foundry set up and are running work.

1. [Execution model](execution-model.md) — the state machine and flow
2. [Configuration](configuration.md) — tune the setup for your needs
3. [Desktop console](desktop.md) — how to use the native window
4. [Troubleshooting](troubleshooting.md) — resolve problems as they arise
5. [Reference](reference.md) — command and tool details when needed

### Contributing to Agent Foundry

Start here if you are developing the plugin itself.

1. [Architecture](architecture.md) — components, design decisions, invariants
2. The codebase: read `src/index.ts`, `src/tools/engine.ts`,
   `src/orchestration/` and `src/core/types.ts`
3. [Getting started](getting-started.md) — install from source
4. `CONTRIBUTING.md` (root) — setup, tests, verification, release process
5. [Reference](reference.md) — tool definitions and state files

## Related files

- `../README.md` — the landing page
- `../CONTRIBUTING.md` — contribution guidelines, tests, release process
- `../CLAUDE.md` — maintainer and agent guide; editorial rules and invariants
- `../examples/` — configuration examples and the README that explains them
