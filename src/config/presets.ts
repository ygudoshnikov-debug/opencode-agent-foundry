import { CONFIGURABLE_ROLES, type ConfigurableRole } from './schema.js';
import type { ModelOption } from '../desktop/protocol.js';

/**
 * Vendor presets: a whole team in one click.
 *
 * Picking a model per role used to mean four separate dropdowns, each defaulting
 * to "use defaults", which asked the human to know four models and how they rank
 * before they could start. A preset answers the only question most people
 * actually have — "whose models am I using?" — and fills the ladder for them.
 *
 * These are NOT defaults. Nothing here applies until someone picks it: with no
 * configuration every role still inherits the model selected in the chat, which
 * is the invariant the smoke test protects. A preset is a menu, not a default.
 *
 * Each role lists candidates in descending preference rather than one id. The
 * same model reaches different people through different providers — a
 * subscription plan, a first-party key, an aggregator — so the preset resolves
 * against the live catalogue and takes the first id that account can actually
 * reach. Without that, a preset would be correct for whoever wrote it and broken
 * for everyone else.
 */

export const PRESET_IDS = ['openai', 'anthropic', 'google', 'china'] as const;

export type PresetId = (typeof PRESET_IDS)[number];

export interface Preset {
  id: PresetId;
  label: string;
  /** One line, shown on the card. Says what the team is, not how good it is. */
  summary: string;
  roles: Readonly<Record<ConfigurableRole, readonly string[]>>;
}

export interface ResolvedPreset {
  id: PresetId;
  label: string;
  summary: string;
  /** Role → the id that will actually be written. Empty means "inherit the chat model". */
  models: Record<ConfigurableRole, string>;
  /** Roles with no reachable candidate. They fall back to the chat model. */
  unavailable: ConfigurableRole[];
  /** True when every role resolved to a model this account can reach. */
  available: boolean;
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    summary: 'GPT-5.6 Sol to plan, 5.5 to decompose, Terra and Luna to execute.',
    roles: {
      architect: ['openai/gpt-5.6-sol', 'openai/gpt-5.6', 'openai/gpt-5.5'],
      lead: ['openai/gpt-5.5', 'openai/gpt-5.6', 'openai/gpt-5.6-terra'],
      analyst: ['openai/gpt-5.6-terra', 'openai/gpt-5.4', 'openai/gpt-5.3-codex'],
      builder: ['openai/gpt-5.6-luna', 'openai/gpt-5.4-nano', 'openai/gpt-5-mini'],
    },
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    summary: 'Fable to design, Opus to decompose, Sonnet to specify, Haiku to build.',
    roles: {
      architect: ['anthropic/claude-fable-5-1', 'anthropic/claude-fable-5', 'anthropic/claude-opus-5'],
      lead: ['anthropic/claude-opus-5', 'anthropic/claude-opus-4-8', 'anthropic/claude-sonnet-5'],
      analyst: ['anthropic/claude-sonnet-5', 'anthropic/claude-sonnet-4-6'],
      builder: ['anthropic/claude-haiku-4-5', 'anthropic/claude-sonnet-5'],
    },
  },
  {
    id: 'google',
    label: 'Google',
    summary: 'Gemini Pro for architecture, 3.8 Flash for the rest, Flash-Lite on the builds.',
    roles: {
      architect: ['google/gemini-3.1-pro-preview', 'google/gemini-3.8-flash', 'google/gemini-2.5-pro'],
      lead: ['google/gemini-3.8-flash', 'google/gemini-3.7-flash', 'google/gemini-3.6-flash'],
      analyst: ['google/gemini-3.8-flash', 'google/gemini-3.7-flash', 'google/gemini-3.6-flash'],
      builder: ['google/gemini-3.5-flash-lite', 'google/gemini-3.1-flash-lite', 'google/gemini-2.5-flash-lite'],
    },
  },
  {
    id: 'china',
    label: 'China',
    summary: 'Kimi, Qwen, GLM and DeepSeek — one lab per role, through OpenCode Go.',
    roles: {
      architect: ['opencode-go/kimi-k3', 'opencode-go/qwen3.8-max', 'opencode-go/glm-5.3'],
      lead: ['opencode-go/qwen3.8-max', 'opencode-go/glm-5.3', 'opencode-go/kimi-k2.7-code'],
      analyst: ['opencode-go/glm-5.3', 'opencode-go/qwen3.7-plus', 'opencode-go/deepseek-v4-pro'],
      builder: ['opencode-go/deepseek-v4-flash', 'opencode-go/qwen3.8-flash', 'opencode-go/glm-5.3-flash'],
    },
  },
];

/**
 * Deliberate exceptions to the rules `check:presets` enforces.
 *
 * Those rules exist to catch accidents, and an accident is indistinguishable
 * from a decision unless the decision is written down. Each key is either a
 * model id (exempting it from the "no unstable primary" rule) or a
 * "<preset>:<role>" pair (exempting that rung from the descending-cost rule),
 * and each needs a reason someone can disagree with later.
 */
export const ACKNOWLEDGED: Readonly<Record<string, string>> = {
  'google/gemini-3.1-pro-preview':
    'Google publishes no stable Gemini Pro in the catalogue — the entire Pro line is preview-only, so the rule would ban Pro outright rather than protect anyone.',
  'openai:lead':
    'gpt-5.5 is the previous flagship: stronger than the 5.6 mid tier, but priced above the newer 5.6 flagship sitting above it. Cost descends everywhere else; price is only a proxy for capability, and the proxy inverts across generations.',
};

export function presetById(id: string): Preset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}

export function isPresetId(id: string): id is PresetId {
  return (PRESET_IDS as readonly string[]).includes(id);
}

/**
 * Picks the first candidate this account can actually reach.
 *
 * An empty catalogue means the plugin could not read OpenCode's provider list —
 * offline, or a client that does not expose it. Guessing "unavailable" there
 * would grey out every preset for a user whose setup is fine, so an unknown
 * catalogue optimistically takes the first candidate.
 */
export function resolvePreset(preset: Preset, catalogue: readonly ModelOption[]): ResolvedPreset {
  const reachable = new Set(catalogue.map((option) => option.id));
  const models = {} as Record<ConfigurableRole, string>;
  const unavailable: ConfigurableRole[] = [];

  for (const role of CONFIGURABLE_ROLES) {
    const candidates = preset.roles[role] ?? [];
    if (!reachable.size) {
      models[role] = candidates[0] ?? '';
      continue;
    }
    const hit = candidates.find((id) => reachable.has(id));
    if (hit) {
      models[role] = hit;
    } else {
      // No reachable candidate: inherit the chat model rather than write an id
      // that would fail at dispatch time.
      models[role] = '';
      unavailable.push(role);
    }
  }

  return {
    id: preset.id,
    label: preset.label,
    summary: preset.summary,
    models,
    unavailable,
    available: unavailable.length === 0,
  };
}

export function resolveAllPresets(catalogue: readonly ModelOption[]): ResolvedPreset[] {
  return PRESETS.map((preset) => resolvePreset(preset, catalogue));
}
