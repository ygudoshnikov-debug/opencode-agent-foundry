import { applySetup as writeSetup, loadConfig, type SetupChoice } from '../config/loader.js';
import { CONFIGURABLE_ROLES, type ConfigurableRole, type FoundryConfig } from '../config/schema.js';
import { presetById, resolveAllPresets, resolvePreset, type PresetId } from '../config/presets.js';
import type { ModelOption, ResolvedPresetView, RoleModelBinding, RuntimeView } from '../desktop/protocol.js';
import type { Role } from '../core/types.js';
import type { Host } from './host.js';

/**
 * Session configuration.
 *
 * Chat and the desktop are two views of ONE object built here, written through
 * ONE path, so they cannot drift and neither has to reimplement the other's
 * rules. Chat asks a single either/or question — keep what you have, or open
 * the window — and every actual choice of models happens on the screen that can
 * show them.
 */

const ROLE_DESCRIPTIONS: Readonly<Record<Role, string>> = {
  orchestrator: 'Talks to you and coordinates everything. Always runs on the model selected in the chat.',
  architect: 'Project-wide architecture, sequencing and acceptance.',
  lead: 'One module: contracts and decomposition.',
  analyst: 'One functionality: precise tasks and review.',
  builder: 'One task: implementation, with evidence.',
};

function bindings(config: FoundryConfig): RoleModelBinding[] {
  return [
    {
      role: 'orchestrator',
      model: '',
      configurable: false,
      description: ROLE_DESCRIPTIONS.orchestrator,
    },
    ...CONFIGURABLE_ROLES.map((role) => ({
      role: role as Role,
      model: config.models[role],
      configurable: true,
      description: ROLE_DESCRIPTIONS[role],
    })),
  ];
}

/**
 * Reports which shipped preset, if any, the current bindings correspond to.
 *
 * Without this the setup screen cannot show what is already selected: it would
 * hold four model ids and no idea they add up to "Anthropic". Compared against
 * the resolved ids rather than the raw candidate lists, because that is what
 * was actually written.
 */
function matchPreset(config: FoundryConfig, catalogue: readonly ModelOption[]): PresetId | null {
  // An unconfigured project has every binding empty, and so does a preset none
  // of whose models this account can reach. Without this guard those two
  // compare equal and a brand new project reports whichever unreachable preset
  // happens to be listed first as its current selection.
  if (CONFIGURABLE_ROLES.every((role) => !config.models[role])) return null;

  for (const resolved of resolveAllPresets(catalogue)) {
    if (!resolved.available) continue;
    const same = CONFIGURABLE_ROLES.every((role) => config.models[role] === resolved.models[role]);
    if (same) return resolved.id;
  }
  return null;
}

/**
 * Tracks a chat session asking for the setup screen.
 *
 * The desktop shows onboarding when a project is unconfigured, which is the
 * wrong test once "open the window to reconfigure" is an answer the human can
 * give: a configured project would open straight onto the dashboard and the
 * request would be silently dropped. This is in-memory and per-process on
 * purpose — it is a request in flight, not a setting.
 */
export class SetupRequest {
  private pending = false;

  raise(): void {
    this.pending = true;
  }

  get isPending(): boolean {
    return this.pending;
  }

  /** Called when a setup is actually written, from any surface. */
  clear(): void {
    this.pending = false;
  }
}

export interface RuntimeViewOptions {
  setupRequest?: SetupRequest;
}

/**
 * Everything a surface needs to show or change the setup, in one read.
 *
 * The catalogue comes from OpenCode's live provider list, so the pickers offer
 * models that actually resolve rather than free text the user has to get right,
 * and each preset is resolved against it so an unreachable one says so instead
 * of failing later at dispatch.
 */
export async function runtimeView(
  projectDir: string,
  host: Host,
  options: RuntimeViewOptions = {},
): Promise<RuntimeView> {
  const { config, sources } = loadConfig(projectDir);
  let catalogue: ModelOption[] = [];
  try {
    catalogue = await host.catalogue();
  } catch {
    // A missing catalogue degrades to free-text entry; it must not fail the read.
  }

  const presets: ResolvedPresetView[] = resolveAllPresets(catalogue).map((resolved) => ({
    id: resolved.id,
    label: resolved.label,
    summary: resolved.summary,
    models: resolved.models,
    unavailable: resolved.unavailable,
    available: resolved.available,
  }));

  return {
    source: sources.length ? sources : ['defaults'],
    configured: config.configured,
    setup_requested: options.setupRequest?.isPending ?? false,
    models: bindings(config),
    catalogue,
    presets,
    active_preset: matchPreset(config, catalogue),
    builders: config.execution.max_parallel,
    execution: config.execution,
    desktop: config.desktop,
    limits: config.limits,
  };
}

/** What a surface may ask for. `preset` resolves before anything is written. */
export interface SetupInput {
  choice: 'keep' | 'inherit' | 'preset' | 'custom';
  preset?: string;
  models?: Partial<Record<ConfigurableRole, string>>;
  builders?: number;
}

export interface SetupOutcome {
  applied: SetupInput['choice'];
  preset?: PresetId;
  configured: true;
  builders: number;
  models: Record<ConfigurableRole, string>;
  /** Roles whose preset model was not reachable, so they inherit the chat model. */
  inherited: ConfigurableRole[];
  written_to: string;
}

/**
 * Writes a setup.
 *
 * A preset is resolved here rather than stored as an id: the config file holds
 * concrete model bindings, so every other surface — and the dispatcher — reads
 * one shape and nothing has to know what a preset is.
 */
export async function applySetup(
  projectDir: string,
  input: SetupInput,
  host: Host,
  options: RuntimeViewOptions = {},
): Promise<SetupOutcome> {
  let write: SetupChoice;
  let inherited: ConfigurableRole[] = [];
  let usedPreset: PresetId | undefined;

  if (input.choice === 'preset') {
    const preset = presetById(input.preset ?? '');
    if (!preset) {
      throw new Error(`Unknown preset "${input.preset ?? ''}". Read the available ones from the runtime view.`);
    }
    let catalogue: ModelOption[] = [];
    try {
      catalogue = await host.catalogue();
    } catch {
      // Unknown catalogue: resolvePreset then takes each role's first candidate.
    }
    const resolved = resolvePreset(preset, catalogue);
    usedPreset = resolved.id;
    inherited = resolved.unavailable;
    write = {
      choice: 'custom',
      models: resolved.models,
      ...(typeof input.builders === 'number' ? { builders: input.builders } : {}),
    };
  } else {
    write = {
      choice: input.choice,
      ...(input.models ? { models: input.models } : {}),
      ...(typeof input.builders === 'number' ? { builders: input.builders } : {}),
    };
  }

  const { path, config } = writeSetup(projectDir, write);
  options.setupRequest?.clear();

  return {
    applied: input.choice,
    ...(usedPreset ? { preset: usedPreset } : {}),
    configured: true,
    builders: config.execution.max_parallel,
    models: {
      architect: config.models.architect,
      lead: config.models.lead,
      analyst: config.models.analyst,
      builder: config.models.builder,
    },
    inherited,
    written_to: path,
  };
}

/**
 * Remembers which conversations have already been offered configuration.
 *
 * Per process and in memory on purpose: it is bookkeeping about a conversation,
 * not a setting, so it does not belong in the config file, and losing it across
 * a plugin reload costs at most one extra offer.
 */
export class SessionGate {
  private readonly greeted = new Set<string>();

  /** True the first time a session is seen, false every time after. */
  claim(sessionID: string): boolean {
    if (!sessionID) return false;
    if (this.greeted.has(sessionID)) return false;
    this.greeted.add(sessionID);
    return true;
  }

  seen(sessionID: string): boolean {
    return this.greeted.has(sessionID);
  }

  /** Test seam. */
  reset(): void {
    this.greeted.clear();
  }
}

export type { SetupChoice };
