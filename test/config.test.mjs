import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');

// Import compiled modules - use file URL for Windows compatibility
const schemaModule = await import(new URL(`file://${distDir}/config/schema.js`));
const loaderModule = await import(new URL(`file://${distDir}/config/loader.js`));

const { defaultConfig, migrateLegacy, parseConfig, CONFIG_VERSION, FoundryConfigSchema } = schemaModule;
const { loadConfig, setRoleModel, findProjectConfig } = loaderModule;

test('config: defaults have NO model bound for any role (decoupling invariant)', (t) => {
  const cfg = defaultConfig();
  assert.strictEqual(cfg.models.architect, '');
  assert.strictEqual(cfg.models.lead, '');
  assert.strictEqual(cfg.models.analyst, '');
  assert.strictEqual(cfg.models.builder, '');
  assert.strictEqual(cfg.version, CONFIG_VERSION);
});

test('config: migrateLegacy maps v1 file to v2 models/execution and DROPS mode', (t) => {
  const v1 = {
    version: 1,
    roles: {
      fable: { model: 'openai/gpt-4' },
      opus: { model: 'anthropic/claude-opus' },
      sonnet: { model: 'anthropic/claude-sonnet' },
      haiku: { model: 'anthropic/claude-haiku' },
    },
    mode: 'streaming', // Should be dropped
    max_executors_per_stage: 8, // Should be dropped
  };

  const result = migrateLegacy(v1);
  assert.strictEqual(result.version, CONFIG_VERSION);
  assert(result.models);
  assert.strictEqual(result.models.architect, 'openai/gpt-4');
  assert.strictEqual(result.models.lead, 'anthropic/claude-opus');
  assert.strictEqual(result.models.analyst, 'anthropic/claude-sonnet');
  assert.strictEqual(result.models.builder, 'anthropic/claude-haiku');
  assert.strictEqual(result.mode, undefined);
  assert.strictEqual(result.max_executors_per_stage, undefined);
});

test('config: v1 config "luna" model is dropped (orchestrator is never bound)', (t) => {
  const v1 = {
    version: 1,
    roles: {
      fable: { model: 'openai/gpt-4' },
      luna: { model: 'anthropic/luna-model' }, // Should be dropped
      haiku: { model: 'anthropic/claude-haiku' },
    },
  };

  const result = migrateLegacy(v1);
  assert(!result.models.luna, 'luna should not exist in models');
  assert.strictEqual(result.models.architect, 'openai/gpt-4');
  assert.strictEqual(result.models.builder, 'anthropic/claude-haiku');
});

test('config: project config overrides global config', async (t) => {
  const tmpDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-test-'));
  const globalDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-global-'));
  try {
    process.env.OPENCODE_CONFIG_DIR = globalDir;
    const globalCfgPath = join(globalDir, 'agent-foundry.json');
    const projectCfgPath = join(tmpDir, 'agent-foundry.json');

    writeFileSync(
      globalCfgPath,
      JSON.stringify({
        version: CONFIG_VERSION,
        models: { architect: 'global/model' },
      }),
    );

    writeFileSync(
      projectCfgPath,
      JSON.stringify({
        version: CONFIG_VERSION,
        models: { architect: 'project/model' },
      }),
    );

    const loaded = loadConfig(tmpDir);
    assert.strictEqual(loaded.config.models.architect, 'project/model');
    assert(loaded.sources.includes(globalCfgPath));
    assert(loaded.sources.includes(projectCfgPath));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(globalDir, { recursive: true, force: true });
    delete process.env.OPENCODE_CONFIG_DIR;
  }
});

test('config: setRoleModel writes the file and setting "" clears the binding', async (t) => {
  const tmpDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-test-'));
  const globalDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-global-'));
  try {
    process.env.OPENCODE_CONFIG_DIR = globalDir;

    // Set a model
    let result = setRoleModel(tmpDir, 'architect', 'test/model-1');
    assert.strictEqual(result.models.architect, 'test/model-1');
    assert(result.path.includes('agent-foundry.json'));

    // Read file to verify persistence
    let content = JSON.parse(readFileSync(result.path, 'utf8'));
    assert.strictEqual(content.models.architect, 'test/model-1');

    // Clear by setting empty string
    result = setRoleModel(tmpDir, 'architect', '');
    assert(!result.models.architect || result.models.architect === '', 'architect should be cleared');

    content = JSON.parse(readFileSync(result.path, 'utf8'));
    assert(!content.models.architect, 'file should not have architect binding');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(globalDir, { recursive: true, force: true });
    delete process.env.OPENCODE_CONFIG_DIR;
  }
});

test('config: malformed JSON config does not throw and falls back to defaults', async (t) => {
  const tmpDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-test-'));
  try {
    process.env.OPENCODE_CONFIG_DIR = tmpDir;

    const badPath = join(tmpDir, 'agent-foundry.json');
    writeFileSync(badPath, '{ invalid json !!!');

    const loaded = loadConfig(tmpDir);
    assert(loaded.config);
    // Should have defaults, not throw
    assert.strictEqual(loaded.config.models.architect, '');
    // The bad file should NOT be in sources since it failed to parse
    assert(!loaded.sources.includes(badPath));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.OPENCODE_CONFIG_DIR;
  }
});

/**
 * Regression: a config WITHOUT an explicit `version` must not be treated as v1.
 *
 * The migration rebuilds the object from the keys it knows about, so running a
 * current config through it dropped `desktop`, `context`, `limits` and
 * `pricing` on the floor. Since `version` is optional and the documented
 * example omits it, that hit essentially every real config.
 */
test('config: a v2 file without an explicit version keeps every section', () => {
  const raw = {
    desktop: { enabled: false, port: 4321 },
    context: { builder: 4000 },
    limits: { max_cost_per_task_usd: 5 },
    pricing: { 'some/model': { input_per_1k: 1, output_per_1k: 2 } },
  };

  assert.deepStrictEqual(migrateLegacy(raw), raw, 'a non-legacy config must pass through untouched');

  const config = parseConfig(raw);
  assert.strictEqual(config.desktop.enabled, false);
  assert.strictEqual(config.desktop.port, 4321);
  assert.strictEqual(config.context.builder, 4000);
  assert.strictEqual(config.limits.max_cost_per_task_usd, 5);
  assert.deepStrictEqual(config.pricing['some/model'], { input_per_1k: 1, output_per_1k: 2 });
});

test('config: migrating a v1 file preserves its non-legacy sections too', () => {
  const config = parseConfig({
    mode: 'automatic',
    max_executors_per_stage: 7,
    allow_file_overlap: true,
    roles: { haiku: { model: 'vendor/small', max_retries: 5 }, luna: { model: 'vendor/orchestrator' } },
    cost_limits: { max_cost_per_task_usd: 3 },
    desktop: { enabled: false },
  });

  assert.strictEqual(config.models.builder, 'vendor/small', 'v1 role model migrates onto the role');
  assert.strictEqual(config.execution.max_parallel, 7);
  assert.strictEqual(config.execution.allow_file_overlap, true);
  assert.strictEqual(config.execution.max_retries, 5);
  assert.strictEqual(config.limits.max_cost_per_task_usd, 3, 'cost_limits migrates onto limits');
  assert.strictEqual(config.desktop.enabled, false, 'a v2 section alongside v1 keys must survive');
  assert.ok(!('mode' in config), 'execution modes must not survive migration');
  assert.ok(
    !Object.values(config.models).includes('vendor/orchestrator'),
    'the v1 orchestrator model must be dropped, never rebound to another role',
  );
});

test('config: an explicit v2 binding wins over the migrated v1 one', () => {
  const config = parseConfig({
    roles: { haiku: { model: 'vendor/from-v1' } },
    models: { builder: 'vendor/explicit' },
  });
  assert.strictEqual(config.models.builder, 'vendor/explicit');
});
