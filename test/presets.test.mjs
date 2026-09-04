import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const { createEngine } = await import(new URL(`file://${distDir}/tools/engine.js`));
const { createFoundryTools } = await import(new URL(`file://${distDir}/tools/definitions.js`));
const { SessionGate, SetupRequest } = await import(new URL(`file://${distDir}/runtime/setup.js`));
const { PRESETS, ACKNOWLEDGED, resolvePreset, presetById } = await import(
  new URL(`file://${distDir}/config/presets.js`),
);

const tmp = (name) => mkdtempSync(join(process.env.TEMP || '/tmp', name));

const option = (id) => {
  const [providerID, ...rest] = id.split('/');
  return { id, providerID, modelID: rest.join('/'), name: rest.join('/'), provider: providerID };
};

/** A host whose catalogue is exactly the ids given. */
function hostWith(ids) {
  return {
    async catalogue() {
      return ids.map(option);
    },
    async sessionModel() {
      return 'vendor/chat';
    },
    async dispatch() {
      return { ok: true, text: 'ok' };
    },
  };
}

function withProject(fn) {
  const dir = tmp('foundry-preset-');
  const globalDir = tmp('foundry-global-');
  process.env.OPENCODE_CONFIG_DIR = globalDir;
  try {
    return fn(dir);
  } finally {
    delete process.env.OPENCODE_CONFIG_DIR;
    rmSync(dir, { recursive: true, force: true });
    rmSync(globalDir, { recursive: true, force: true });
  }
}

test('presets: four teams, each covering every configurable role', () => {
  assert.deepStrictEqual(
    PRESETS.map((p) => p.id),
    ['openai', 'anthropic', 'google', 'china'],
  );
  for (const preset of PRESETS) {
    for (const role of ['architect', 'lead', 'analyst', 'builder']) {
      const candidates = preset.roles[role];
      assert.ok(Array.isArray(candidates) && candidates.length, `${preset.id}.${role} has candidates`);
      for (const id of candidates) {
        assert.match(id, /^[^/]+\/.+/, `${id} is a provider/model id`);
      }
    }
  }
});

/**
 * Alpha, preview and "-latest" builds are fine to experiment with and wrong to
 * hand to someone else as a default: they change or vanish under the user.
 * `npm run check:presets` catches this against the real catalogue, but that
 * needs a catalogue to be present — this pins the rule everywhere.
 */
test('presets: no primary is an unstable or moving build', () => {
  const unstable = /(^|[-_])(alpha|beta|preview|exp|experimental|free|contributor|nightly|latest)([-_]|$)/i;
  for (const preset of PRESETS) {
    for (const role of ['architect', 'lead', 'analyst', 'builder']) {
      const primary = preset.roles[role][0];
      const model = primary.slice(primary.indexOf('/') + 1);
      // An exception is allowed only when it is written down with a reason:
      // Google, for instance, publishes no stable Gemini Pro at all.
      if (ACKNOWLEDGED[primary]) continue;
      assert.ok(!unstable.test(model), `${preset.id}.${role} ships "${primary}"`);
    }
  }
});

test('presets: the China team spreads across the Chinese families', () => {
  const china = presetById('china');
  const families = Object.values(china.roles).map((candidates) => candidates[0]);
  const named = ['kimi', 'glm', 'qwen', 'deepseek'];
  for (const family of named) {
    assert.ok(
      families.some((id) => id.includes(family)),
      `${family} should lead one of the roles, got ${families.join(', ')}`,
    );
  }
});

/**
 * A preset written by one person has to work for the next. The same model
 * reaches different accounts through different providers, so the preset picks
 * the first candidate that account can actually reach instead of one fixed id.
 */
test('presets: resolution takes the first candidate the account can reach', () => {
  const preset = presetById('anthropic');
  const second = preset.roles.architect[1];

  const full = resolvePreset(preset, [preset.roles.architect[0]].map(option));
  assert.strictEqual(full.models.architect, preset.roles.architect[0], 'the primary wins when present');

  const fallback = resolvePreset(preset, [second].map(option));
  assert.strictEqual(fallback.models.architect, second, 'falls through to the next reachable one');
});

test('presets: an unreachable role inherits the chat model rather than a broken id', () => {
  const preset = presetById('openai');
  const resolved = resolvePreset(preset, [option('someone-else/some-model')]);
  assert.strictEqual(resolved.available, false);
  assert.deepStrictEqual(resolved.unavailable.sort(), ['analyst', 'architect', 'builder', 'lead']);
  for (const role of ['architect', 'lead', 'analyst', 'builder']) {
    assert.strictEqual(resolved.models[role], '', `${role} falls back to the chat model`);
  }
});

test('presets: an unknown catalogue is optimistic, not pessimistic', () => {
  // Reading the provider list can fail for reasons that say nothing about the
  // preset. Greying every team out would be the wrong call.
  const preset = presetById('google');
  const resolved = resolvePreset(preset, []);
  assert.strictEqual(resolved.available, true);
  assert.strictEqual(resolved.models.builder, preset.roles.builder[0]);
});

test('presets: applying one writes concrete bindings and is recognised afterwards', async () => {
  await withProject(async (dir) => {
    const preset = presetById('china');
    const reachable = Object.values(preset.roles).map((candidates) => candidates[0]);
    const host = hostWith(reachable);

    const before = await createEngine(dir, { host }).runtime();
    assert.strictEqual(before.active_preset, null, 'nothing selected yet');
    assert.strictEqual(before.presets.length, 4, 'all four offered');
    assert.strictEqual(before.presets.find((p) => p.id === 'china').available, true);

    const outcome = await createEngine(dir, { host }).setup({ choice: 'preset', preset: 'china', builders: 3 });
    assert.strictEqual(outcome.preset, 'china');
    assert.deepStrictEqual(outcome.inherited, [], 'every role resolved');

    // The file holds model ids, not a preset name: every other surface and the
    // dispatcher read one shape and none of them has to know what a preset is.
    const onDisk = JSON.parse(readFileSync(join(dir, 'agent-foundry.json'), 'utf8'));
    assert.strictEqual(onDisk.models.builder, preset.roles.builder[0]);
    assert.strictEqual(onDisk.configured, true);

    const after = await createEngine(dir, { host }).runtime();
    assert.strictEqual(after.active_preset, 'china', 'the bindings are recognised as the preset again');
    assert.strictEqual(after.builders, 3);
  });
});

test('presets: an unknown preset id is refused, not silently ignored', async () => {
  await withProject(async (dir) => {
    const engine = createEngine(dir, { host: hostWith([]) });
    await assert.rejects(() => engine.setup({ choice: 'preset', preset: 'nope' }), /Unknown preset/);
  });
});

test('setup: chat offers exactly two answers, and "configure" opens the window', async () => {
  await withProject(async (dir) => {
    const setupRequest = new SetupRequest();
    const opened = [];
    const tools = createFoundryTools({
      fallbackDir: dir,
      host: hostWith(['vendor/one']),
      gate: new SessionGate(),
      setupRequest,
      openDesktop: async () => {
        opened.push(true);
        return { status: 'opened', url: 'http://127.0.0.1:1234' };
      },
    });
    const call = async (args) =>
      JSON.parse(await tools.foundry_setup.execute(args, { directory: dir, sessionID: 'ses-1' }));

    const status = await call({ action: 'status' });
    assert.strictEqual(status.ask_now, true);
    assert.deepStrictEqual(Object.keys(status.options).sort(), ['configure', 'keep']);

    const result = await call({ action: 'apply', choice: 'configure' });
    assert.strictEqual(result.opened, true);
    assert.strictEqual(opened.length, 1, 'the window was actually opened');
    assert.match(result.next, /wait/i, 'and the orchestrator is told to wait');

    // The window has to learn a setup was asked for even when the project was
    // configured long ago, or it opens on the dashboard and drops the request.
    const view = await createEngine(dir, { host: hostWith([]), setupRequest }).runtime();
    assert.strictEqual(view.setup_requested, true);
  });
});

test('setup: applying from any surface clears the pending request', async () => {
  await withProject(async (dir) => {
    const setupRequest = new SetupRequest();
    setupRequest.raise();

    const engine = createEngine(dir, { host: hostWith([]), setupRequest });
    assert.strictEqual((await engine.runtime()).setup_requested, true);

    await engine.setup({ choice: 'keep' });
    assert.strictEqual((await engine.runtime()).setup_requested, false, 'answered, so no longer pending');
  });
});

/**
 * The window is optional — the plugin has to work with Tauri absent. Chat then
 * cannot just dead-end on "open the window", so it falls back to offering the
 * same presets itself.
 */
test('setup: with no window, "configure" degrades to offering the presets in chat', async () => {
  await withProject(async (dir) => {
    const tools = createFoundryTools({
      fallbackDir: dir,
      host: hostWith(['vendor/one']),
      gate: new SessionGate(),
      setupRequest: new SetupRequest(),
      openDesktop: async () => ({ status: 'disabled', detail: 'desktop.enabled is false' }),
    });

    const result = JSON.parse(
      await tools.foundry_setup.execute(
        { action: 'apply', choice: 'configure' },
        { directory: dir, sessionID: 'ses-1' },
      ),
    );
    assert.strictEqual(result.opened, false);
    assert.match(result.reason, /desktop\.enabled/);
    assert.strictEqual(result.presets.length, 4, 'the same four teams, offered in chat instead');
    assert.match(result.next, /choice="preset"/);
  });
});

test('setup: a preset is inert until someone picks it', async () => {
  await withProject(async (dir) => {
    // The invariant the smoke test protects: shipping a preset table must not
    // make it a default. With no configuration, every role still inherits.
    const view = await createEngine(dir, { host: hostWith(['vendor/one']) }).runtime();
    assert.strictEqual(view.configured, false);
    for (const binding of view.models.filter((m) => m.configurable)) {
      assert.strictEqual(binding.model, '', `${binding.role} inherits until a choice is made`);
    }
  });
});
