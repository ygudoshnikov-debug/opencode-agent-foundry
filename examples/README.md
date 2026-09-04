# Configuration examples

Each example below is a complete, runnable configuration file. Choose one that matches
your use case and copy it to your project or global config directory.

## How to use an example

### For a single project

Copy the example to your project root:

```bash
cp examples/minimal.jsonc ./agent-foundry.jsonc
```

Edit `agent-foundry.jsonc` for your project-specific needs. This configuration applies
only to this project and overrides any global config.

### For all projects (global config)

Copy the example to the global config directory:

```bash
mkdir -p ~/.config/opencode/
cp examples/global.jsonc ~/.config/opencode/agent-foundry.json
```

Global config applies to every project that has no project-level config. Project-level
settings override global ones.

## The examples

### minimal.jsonc

The smallest possible config: inherit everything from defaults and the chat model.

**Use case**: You want Agent Foundry to work out of the box with no configuration.

### per-role.jsonc

Bind a different model per role without affecting execution or context. Useful when you
have access to specific models and want to tune which role runs on which.

**Use case**: Custom model bindings (e.g., your own fine-tuned models) without changing
parallelism or budgets.

### cost-guarded.jsonc

Set spending limits and a custom pricing table. Includes real model ids and cost rates.

**Use case**: Projects where you need to cap costs, or you have different pricing than
the fallback rates (e.g., a custom contract with a vendor).

### headless.jsonc

Desktop console disabled; all features work through the CLI and chat tools.

**Use case**: Running Agent Foundry in CI, on a headless server, or when you prefer not
to use the native window.

### unlimited-parallel.jsonc

Set `max_parallel: 0` to run every ready task concurrently.

**Use case**: Small projects or environments where you want to maximize throughput and
cost is not a concern.

### global.jsonc

Placed in `~/.config/opencode/`, this applies to all projects. Includes comments
explaining each section.

**Use case**: A shared configuration for a team or machine, with project-level overrides
as needed.

## Real model ids

All examples use model ids from the vendor presets:

- **Anthropic**: `anthropic/claude-fable-5-1`, `anthropic/claude-opus-5`,
  `anthropic/claude-sonnet-5`, `anthropic/claude-haiku-4-5`
- **OpenAI**: `openai/gpt-5.6-sol`, `openai/gpt-5.5`, `openai/gpt-5.6-terra`,
  `openai/gpt-5.6-luna`
- **Google**: `google/gemini-3.1-pro-preview`, `google/gemini-3.8-flash`,
  `google/gemini-3.5-flash-lite`
- **OpenCode Go**: `opencode-go/kimi-k3`, `opencode-go/qwen3.8-max`, `opencode-go/glm-5.3`,
  `opencode-go/deepseek-v4-flash`

Substitute your actual model ids as needed. Unknown models fall back to the generic
pricing rate.

## Validation

Validate an example against the schema via your editor's built-in JSON Schema
validation (configure it to use `../opencode-agent-foundry.schema.json`) or from
the command line:

```bash
npx --yes ajv-cli validate -s ../opencode-agent-foundry.schema.json agent-foundry.jsonc
```

To use `ajv-cli`, strip the `//` comments first (they are supported in `.jsonc`
files but not in raw JSON).

## Next steps

- Read the full reference: `../docs/configuration.md`
- Explore the setup flow: `../docs/getting-started.md`
- See how models are bound: `../docs/agents.md`
