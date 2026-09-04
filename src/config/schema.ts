import { z } from 'zod';
import { CONFIGURABLE_ROLES, type ConfigurableRole } from '../core/types.js';

/**
 * Foundry configuration.
 *
 * Two rules govern this file:
 *
 * 1. Agents and models are independent. A role never carries a default model
 *    id in code. `models[role]` is an opaque, user-supplied string; an empty
 *    string means "use the model currently selected in the chat".
 * 2. There is one execution flow. No `mode` field exists, and none may be added.
 */

/** Current on-disk config version. v1 files are migrated on load. */
export const CONFIG_VERSION = 2;

const ModelBindingSchema = z
  .string()
  .trim()
  .default('')
  .describe('Model id understood by OpenCode, e.g. "<provider>/<model>". Empty = inherit the chat model.');

/**
 * One binding per configurable role. Every field defaults to '' so a config
 * that mentions no models at all is valid and means "inherit the chat model
 * everywhere" — the zero-coupling default.
 */
const RolesModelSchema = z
  .object({
    architect: ModelBindingSchema,
    lead: ModelBindingSchema,
    analyst: ModelBindingSchema,
    builder: ModelBindingSchema,
  })
  .default({ architect: '', lead: '', analyst: '', builder: '' });

const ExecutionSchema = z
  .object({
    /**
     * How many builders may run at once.
     *
     * 0 means UNLIMITED: the scheduler then starts everything whose
     * dependencies and file locks allow, and concurrency is bounded only by
     * the work itself. There is deliberately no upper cap — the ceiling that
     * matters is the graph, not an arbitrary number.
     */
    max_parallel: z.number().int().min(0).default(4),
    /** When false, two tasks touching the same file cannot run concurrently. */
    allow_file_overlap: z.boolean().default(false),
    /** Attempts allowed before a task escalates instead of retrying. */
    max_retries: z.number().int().min(0).max(10).default(2),
  })
  .default({ max_parallel: 4, allow_file_overlap: false, max_retries: 2 });

const ContextSchema = z
  .object({
    /**
     * Per-role context budget in tokens. Enforced when building execution
     * packets, which is the main lever on cost.
     */
    architect: z.number().int().min(1000).default(24000),
    lead: z.number().int().min(1000).default(16000),
    analyst: z.number().int().min(1000).default(12000),
    builder: z.number().int().min(1000).default(8000),
  })
  .default({ architect: 24000, lead: 16000, analyst: 12000, builder: 8000 });

const DesktopSchema = z
  .object({
    enabled: z.boolean().default(true),
    /** Start the bridge when the plugin loads instead of on first UI request. */
    autostart: z.boolean().default(false),
    /** 0 = ephemeral port chosen by the OS. Always bound to 127.0.0.1. */
    port: z.number().int().min(0).max(65535).default(0),
  })
  .default({ enabled: true, autostart: false, port: 0 });

const LimitsSchema = z
  .object({
    /** 0 disables the guard. */
    max_cost_per_task_usd: z.number().min(0).default(0),
    max_cost_per_project_usd: z.number().min(0).default(0),
  })
  .default({ max_cost_per_task_usd: 0, max_cost_per_project_usd: 0 });

/**
 * Optional price table, keyed by the same opaque model id used in `models`.
 * Config-driven on purpose: no vendor pricing is compiled into the plugin.
 */
const PricingSchema = z
  .record(
    z.string(),
    z.object({ input_per_1k: z.number().min(0), output_per_1k: z.number().min(0) }),
  )
  .default({});

export const FoundryConfigSchema = z
  .object({
    version: z.number().default(CONFIG_VERSION),
    /**
     * True once a human has explicitly chosen a setup for this project.
     *
     * The orchestrator opens a new conversation by offering configuration; this
     * flag is how it knows whether that has already happened, and the desktop
     * uses it to decide whether to show onboarding. Written only by the setup
     * flow, never by hand-editing defaults.
     */
    configured: z.boolean().default(false),
    models: RolesModelSchema,
    execution: ExecutionSchema,
    context: ContextSchema,
    desktop: DesktopSchema,
    limits: LimitsSchema,
    pricing: PricingSchema,
  })
  .passthrough();

export type FoundryConfig = z.infer<typeof FoundryConfigSchema>;

export function defaultConfig(): FoundryConfig {
  return FoundryConfigSchema.parse({});
}

/** Model bound to a role, or '' meaning "inherit the chat model". */
export function modelFor(config: FoundryConfig, role: ConfigurableRole): string {
  return config.models[role] ?? '';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = out[key];
    out[key] = isRecord(value) && isRecord(current) ? deepMerge(current, value) : value;
  }
  return out;
}

/** Keys that only ever existed in the v1 format. */
const LEGACY_KEYS = [
  'roles',
  'mode',
  'max_executors_per_stage',
  'allow_file_overlap',
  'auto_continue',
  'preset',
  'kanban_statuses',
  'default_mcps',
  'default_lcps',
  'cost_limits',
] as const;

/**
 * True when the file is actually in the v1 format.
 *
 * Deliberately NOT "version is missing": `version` is optional, and treating an
 * absent one as v1 would run a current config through the migration and drop
 * every key the migration does not know about.
 */
function isLegacyConfig(raw: Record<string, unknown>): boolean {
  if (Number(raw['version']) >= CONFIG_VERSION) return false;
  return LEGACY_KEYS.some((key) => key in raw);
}

/**
 * Migrate a v1 config onto the v2 shape.
 *
 * v1 named its role keys after models (`roles.haiku.model`); those map
 * positionally onto the role hierarchy. `mode`, `preset`, `auto_continue`,
 * `kanban_statuses` and the MCP lists are dropped because they no longer exist.
 * Everything else the caller wrote is carried over untouched.
 */
export function migrateLegacy(raw: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(raw)) return raw;
  if (!isLegacyConfig(raw)) return raw;

  const legacyRoleMap: Record<string, ConfigurableRole> = {
    fable: 'architect',
    opus: 'lead',
    sonnet: 'analyst',
    haiku: 'builder',
  };

  // Start from everything that is NOT v1-only, so forward-compatible keys and
  // anything already in v2 shape survive the migration untouched.
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!(LEGACY_KEYS as readonly string[]).includes(key)) out[key] = value;
  }
  out['version'] = CONFIG_VERSION;

  const models: Record<string, string> = isRecord(raw['models']) ? { ...(raw['models'] as Record<string, string>) } : {};
  const execution: Record<string, unknown> = isRecord(raw['execution']) ? { ...raw['execution'] } : {};

  const roles = raw['roles'];
  if (isRecord(roles)) {
    for (const [legacyKey, role] of Object.entries(legacyRoleMap)) {
      const entry = roles[legacyKey];
      if (isRecord(entry) && typeof entry['model'] === 'string' && entry['model'].trim()) {
        // An explicit v2 binding wins over the migrated v1 one.
        models[role] ??= entry['model'].trim();
      }
    }
    // `roles.luna` is intentionally ignored: the orchestrator is never bound.
    const builderRetries = isRecord(roles['haiku']) ? roles['haiku']['max_retries'] : undefined;
    if (typeof builderRetries === 'number') execution['max_retries'] ??= builderRetries;
  }

  if (typeof raw['max_executors_per_stage'] === 'number') {
    execution['max_parallel'] ??= raw['max_executors_per_stage'];
  }
  if (typeof raw['allow_file_overlap'] === 'boolean') {
    execution['allow_file_overlap'] ??= raw['allow_file_overlap'];
  }
  if (isRecord(raw['cost_limits'])) {
    const limits = isRecord(out['limits']) ? { ...out['limits'] } : {};
    for (const [key, value] of Object.entries(raw['cost_limits'])) limits[key] ??= value;
    out['limits'] = limits;
  }

  if (Object.keys(models).length) out['models'] = models;
  if (Object.keys(execution).length) out['execution'] = execution;
  return out;
}

export function parseConfig(raw: unknown): FoundryConfig {
  if (!isRecord(raw)) return defaultConfig();
  const migrated = migrateLegacy(raw);
  const parsed = FoundryConfigSchema.safeParse(migrated);
  return parsed.success ? parsed.data : defaultConfig();
}

export { CONFIGURABLE_ROLES };
export type { ConfigurableRole };
