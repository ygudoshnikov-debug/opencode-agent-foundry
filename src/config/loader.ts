import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import {
  CONFIG_VERSION,
  defaultConfig,
  deepMerge,
  FoundryConfigSchema,
  isRecord,
  migrateLegacy,
  type ConfigurableRole,
  type FoundryConfig,
} from './schema.js';

const PROJECT_FILES = ['agent-foundry.json', 'agent-foundry.jsonc', '.opencode/agent-foundry.json'];
const GLOBAL_FILES = ['agent-foundry.json', 'opencode-agent-foundry.json'];

export interface LoadedConfig {
  config: FoundryConfig;
  /** Files that contributed, in precedence order (later wins). */
  sources: string[];
}

/** Strips whole-line `//` comments so .jsonc files parse. Never throws. */
function stripComments(text: string): string {
  return text
    .replace(/^﻿/, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null;
    const parsed: unknown = JSON.parse(stripComments(readFileSync(path, 'utf8')));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function globalConfigDir(): string {
  return process.env['OPENCODE_CONFIG_DIR'] ?? join(homedir(), '.config', 'opencode');
}

export function findProjectConfig(projectDir: string): string | null {
  for (const name of PROJECT_FILES) {
    const path = join(projectDir, name);
    if (existsSync(path)) return path;
  }
  return null;
}

/** Where a new project-level config is written when the UI changes a binding. */
export function projectConfigPath(projectDir: string): string {
  return findProjectConfig(projectDir) ?? join(projectDir, 'agent-foundry.json');
}

/**
 * defaults <- global <- project. Never throws: a malformed file is skipped and
 * reported through `sources` omission rather than breaking plugin startup.
 */
export function loadConfig(projectDir: string): LoadedConfig {
  let merged: Record<string, unknown> = { version: CONFIG_VERSION };
  const sources: string[] = ['defaults'];

  for (const name of GLOBAL_FILES) {
    const path = join(globalConfigDir(), name);
    const raw = readJson(path);
    if (!raw) continue;
    merged = deepMerge(merged, migrateLegacy(raw));
    sources.push(path);
  }

  const projectFile = findProjectConfig(projectDir);
  if (projectFile) {
    const raw = readJson(projectFile);
    if (raw) {
      merged = deepMerge(merged, migrateLegacy(raw));
      sources.push(projectFile);
    }
  }

  const parsed = FoundryConfigSchema.safeParse(merged);
  return { config: parsed.success ? parsed.data : defaultConfig(), sources };
}

/** v1-only keys, dropped on write so a migrated file stops re-migrating. */
const DROP_ON_WRITE = [
  'roles',
  'mode',
  'max_executors_per_stage',
  'allow_file_overlap',
  'preset',
  'auto_continue',
  'kanban_statuses',
  'default_mcps',
  'default_lcps',
  'cost_limits',
] as const;

/**
 * Reads the project config, applies a change, and writes it back.
 *
 * Every persistent settings change goes through here, so the file stays the one
 * place settings live and every surface — chat tool, CLI, desktop — sees the
 * same result on its next read.
 */
function mutateProjectConfig(
  projectDir: string,
  apply: (draft: Record<string, unknown>) => void,
): { path: string; config: Record<string, unknown> } {
  const path = projectConfigPath(projectDir);
  const draft = migrateLegacy(readJson(path) ?? {});
  draft['version'] = CONFIG_VERSION;
  apply(draft);
  for (const key of DROP_ON_WRITE) delete draft[key];

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
  return { path, config: draft };
}

/**
 * Bind (or clear, with '') a model for one role and persist it to the project
 * config. This is what makes models user-selectable at runtime, which is the
 * whole point of keeping them out of the agent definitions.
 */
export function setRoleModel(
  projectDir: string,
  role: ConfigurableRole,
  model: string,
): { path: string; models: Record<string, string> } {
  let models: Record<string, string> = {};
  const { path } = mutateProjectConfig(projectDir, (draft) => {
    const current = isRecord(draft['models']) ? { ...(draft['models'] as Record<string, string>) } : {};
    const trimmed = model.trim();
    if (trimmed) current[role] = trimmed;
    else delete current[role];
    draft['models'] = current;
    models = current;
  });
  return { path, models };
}

/**
 * The ways a setup can be written.
 *
 * `configure` is deliberately absent: opening the desktop window changes no
 * settings, so it never reaches this layer. It is handled where the tools live.
 */
export type SetupChoiceKind = 'keep' | 'inherit' | 'custom';

export interface SetupChoice {
  /**
   * `inherit` clears every binding so all roles follow the chat model, `keep`
   * records the current settings as chosen without changing them, and `custom`
   * applies what was supplied. A preset is resolved against the live catalogue
   * first and arrives here as `custom`.
   */
  choice: SetupChoiceKind;
  models?: Partial<Record<ConfigurableRole, string>>;
  /** 0 = unlimited. */
  builders?: number;
}

/**
 * Applies the opening configuration choice and marks the project configured.
 *
 * This is the single write path behind both the chat onboarding and the desktop
 * onboarding screen, which is why neither can drift from the other.
 */
export function applySetup(projectDir: string, setup: SetupChoice): { path: string; config: FoundryConfig } {
  const { path } = mutateProjectConfig(projectDir, (draft) => {
    if (setup.choice === 'inherit') {
      delete draft['models'];
      delete draft['execution'];
      delete draft['context'];
      delete draft['limits'];
    }

    if (setup.choice === 'custom') {
      if (setup.models) {
        const current = isRecord(draft['models']) ? { ...(draft['models'] as Record<string, string>) } : {};
        for (const [role, model] of Object.entries(setup.models)) {
          const trimmed = (model ?? '').trim();
          if (trimmed) current[role] = trimmed;
          else delete current[role];
        }
        draft['models'] = current;
      }
      if (typeof setup.builders === 'number' && Number.isFinite(setup.builders)) {
        const execution = isRecord(draft['execution']) ? { ...draft['execution'] } : {};
        execution['max_parallel'] = Math.max(0, Math.floor(setup.builders));
        draft['execution'] = execution;
      }
    }

    // Recorded for every choice, including "keep": the point of the flag is
    // that a human has decided, not that anything changed.
    draft['configured'] = true;
  });

  return { path, config: loadConfig(projectDir).config };
}
