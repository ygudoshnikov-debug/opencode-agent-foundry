import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const { createEngine } = await import(new URL(`file://${distDir}/tools/engine.js`));
const { defaultConfig } = await import(new URL(`file://${distDir}/config/schema.js`));
const { computeSchedule } = await import(new URL(`file://${distDir}/orchestration/scheduler.js`));
const { SessionGate } = await import(new URL(`file://${distDir}/runtime/setup.js`));
const { parseModel, ROLE_TOOLS, OFFLINE_HOST } = await import(new URL(`file://${distDir}/runtime/host.js`));
const { delegateMany } = await import(new URL(`file://${distDir}/orchestration/delegation.js`));

const tmp = (name) => mkdtempSync(join(process.env.TEMP || '/tmp', name));

/** A host that records every dispatch it is asked to perform. */
function recordingHost() {
  const calls = [];
  return {
    calls,
    async catalogue() {
      return [
        { id: 'vendor/big', providerID: 'vendor', modelID: 'big', name: 'Big', provider: 'Vendor' },
        { id: 'vendor/small', providerID: 'vendor', modelID: 'small', name: 'Small', provider: 'Vendor' },
      ];
    },
    async sessionModel() {
      return 'vendor/chat';
    },
    async dispatch(request) {
      calls.push(request);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { ok: true, text: `done ${request.role}`, sessionID: 'child', model: request.model };
    },
  };
}

function readyTask(id, file) {
  return {
    id,
    title: id,
    objective: '',
    status: 'READY',
    priority: 5,
    owner: 'analyst',
    executor: 'builder',
    depends_on: [],
    blocks: [],
    related_to: [],
    child_tasks: [],
    allowed_files: [file],
    acceptance_criteria: ['ok'],
    anchors: [],
    attempts: 0,
    history: [],
    review_gates: [],
    created_at: '',
    updated_at: '',
  };
}

test('scheduler: 0 means unlimited, and the reported limit stays JSON-safe', () => {
  const tasks = Array.from({ length: 7 }, (_, i) => readyTask(`T-${i}`, `f${i}.ts`));

  const capped = computeSchedule(tasks, { maxParallel: 3, allowFileOverlap: false });
  assert.strictEqual(capped.started.length, 3);
  assert.strictEqual(capped.limit, 3);

  const unlimited = computeSchedule(tasks, { maxParallel: 0, allowFileOverlap: false });
  assert.strictEqual(unlimited.started.length, 7, 'every independent task starts');
  assert.strictEqual(unlimited.limit, 0, 'the limit round-trips through JSON as 0');
  assert.ok(Number.isFinite(unlimited.limit), 'Infinity must never reach a surface');
});

test('scheduler: unlimited still honours file locks', () => {
  const tasks = [readyTask('A', 'same.ts'), readyTask('B', 'same.ts'), readyTask('C', 'other.ts')];
  const decision = computeSchedule(tasks, { maxParallel: 0, allowFileOverlap: false });
  assert.strictEqual(decision.started.length, 2, 'the two tasks sharing a file are serialised');
  assert.ok(decision.deferred.some((d) => /file lock/.test(d.reason)));
});

test('host: parseModel keeps model ids that contain slashes', () => {
  assert.deepStrictEqual(parseModel('vendor/model'), { providerID: 'vendor', modelID: 'model' });
  assert.deepStrictEqual(parseModel('vendor/family/model'), { providerID: 'vendor', modelID: 'family/model' });
  assert.strictEqual(parseModel('novendor'), null);
  assert.strictEqual(parseModel('/leading'), null);
  assert.strictEqual(parseModel('trailing/'), null);
});

test('host: a builder cannot reach the planning or dispatch tools', () => {
  for (const forbidden of ['foundry_setup', 'foundry_plan', 'foundry_apply_plan', 'foundry_next']) {
    assert.strictEqual(ROLE_TOOLS.builder[forbidden], false, `${forbidden} must be denied to builders`);
  }
  assert.strictEqual(ROLE_TOOLS.architect.foundry_setup, false, 'no role may reconfigure the project');
});

test('setup: the session gate offers configuration once per conversation', () => {
  const gate = new SessionGate();
  assert.strictEqual(gate.claim('ses-1'), true, 'first sight of a session');
  assert.strictEqual(gate.claim('ses-1'), false, 'never twice');
  assert.strictEqual(gate.claim('ses-2'), true, 'a different conversation is greeted');
  assert.strictEqual(gate.claim(''), false, 'a missing session id is never claimed');
});

test('setup: choices persist and are visible to every other surface', async () => {
  const dir = tmp('foundry-setup-');
  const globalDir = tmp('foundry-global-');
  process.env.OPENCODE_CONFIG_DIR = globalDir;
  try {
    const host = recordingHost();
    const engine = createEngine(dir, { host });

    const before = await engine.runtime();
    assert.strictEqual(before.configured, false, 'a fresh project is unconfigured');
    assert.strictEqual(before.catalogue.length, 2, 'the catalogue comes from the host');

    await engine.setup({ choice: 'custom', models: { builder: 'vendor/small' }, builders: 0 });

    // A NEW engine, as another surface would create: the change lives in the
    // file, not in one process's memory.
    const after = await createEngine(dir, { host }).runtime();
    assert.strictEqual(after.configured, true);
    assert.strictEqual(after.builders, 0, 'unlimited survives the round trip');
    assert.strictEqual(after.models.find((m) => m.role === 'builder').model, 'vendor/small');
    assert.strictEqual(
      after.models.find((m) => m.role === 'orchestrator').configurable,
      false,
      'the orchestrator is never bindable',
    );

    const onDisk = JSON.parse(readFileSync(join(dir, 'agent-foundry.json'), 'utf8'));
    assert.strictEqual(onDisk.configured, true);
    assert.strictEqual(onDisk.execution.max_parallel, 0);
  } finally {
    delete process.env.OPENCODE_CONFIG_DIR;
    rmSync(dir, { recursive: true, force: true });
    rmSync(globalDir, { recursive: true, force: true });
  }
});

test('setup: "inherit" clears bindings but still records the choice', async () => {
  const dir = tmp('foundry-defaults-');
  const globalDir = tmp('foundry-global-');
  process.env.OPENCODE_CONFIG_DIR = globalDir;
  try {
    const host = recordingHost();
    await createEngine(dir, { host }).setup({ choice: 'custom', models: { builder: 'vendor/small' }, builders: 9 });
    await createEngine(dir, { host }).setup({ choice: 'inherit' });

    const view = await createEngine(dir, { host }).runtime();
    assert.strictEqual(view.configured, true, 'choosing defaults is still a choice');
    assert.strictEqual(view.models.find((m) => m.role === 'builder').model, '', 'bindings cleared');
    assert.strictEqual(view.builders, 4, 'back to the shipped default');
  } finally {
    delete process.env.OPENCODE_CONFIG_DIR;
    rmSync(dir, { recursive: true, force: true });
    rmSync(globalDir, { recursive: true, force: true });
  }
});

/**
 * The whole point of dispatching from the plugin instead of through the chat:
 * a role runs on the model configuration names RIGHT NOW, not the one frozen
 * into its agent definition when OpenCode started. OpenCode 1.18 cannot
 * re-register agents, so this is the only way a rebinding can take effect
 * without a restart.
 */
test('delegation: the model is resolved at dispatch time, not at registration', async () => {
  const dir = tmp('foundry-dispatch-');
  const globalDir = tmp('foundry-global-');
  process.env.OPENCODE_CONFIG_DIR = globalDir;
  try {
    const host = recordingHost();
    createEngine(dir, { host }).start('Dispatch test');

    await createEngine(dir, { host }).setup({ choice: 'custom', models: { architect: 'vendor/big' } });
    await createEngine(dir, { host }).delegateRole({
      role: 'architect',
      sessionID: 'ses-1',
      directory: dir,
      brief: 'shape it',
    });
    assert.strictEqual(host.calls.at(-1).model, 'vendor/big');

    // Rebind and dispatch again — no restart, no re-registration.
    await createEngine(dir, { host }).setup({ choice: 'custom', models: { architect: 'vendor/small' } });
    await createEngine(dir, { host }).delegateRole({
      role: 'architect',
      sessionID: 'ses-1',
      directory: dir,
      brief: 'shape it again',
    });
    assert.strictEqual(host.calls.at(-1).model, 'vendor/small', 'the new binding took effect immediately');
  } finally {
    delete process.env.OPENCODE_CONFIG_DIR;
    rmSync(dir, { recursive: true, force: true });
    rmSync(globalDir, { recursive: true, force: true });
  }
});

test('delegation: the packet reaches the role, scoped and within budget', async () => {
  const dir = tmp('foundry-packet-');
  const globalDir = tmp('foundry-global-');
  process.env.OPENCODE_CONFIG_DIR = globalDir;
  try {
    const host = recordingHost();
    const engine = createEngine(dir, { host });
    engine.start('Packet test');
    engine.planSubmit({
      author: 'analyst',
      scope: 's',
      summary: 'one task',
      proposals: [
        {
          title: 'Do it',
          objective: 'it is done',
          allowed_files: ['src/a.ts'],
          acceptance_criteria: ['works'],
          verification: 'npm test',
        },
      ],
    });
    engine.planApply('PLAN-001');

    const result = await createEngine(dir, { host }).delegateRole({
      role: 'builder',
      sessionID: 'ses-1',
      directory: dir,
      taskId: 'TASK-001',
    });

    const call = host.calls.at(-1);
    assert.strictEqual(call.role, 'builder');
    assert.match(call.prompt, /TASK-001/, 'the packet names the task');
    assert.match(call.prompt, /src\/a\.ts/, 'and its scope');
    assert.ok(!call.prompt.includes('PLAN-001'), 'a builder is not told about planning');
    assert.strictEqual(call.tools.foundry_apply_plan, false, 'tools are restricted at dispatch');
    assert.ok(result.estimated_tokens < 2000, `packet should stay small, was ${result.estimated_tokens}`);
    assert.strictEqual(result.ok, true);
  } finally {
    delete process.env.OPENCODE_CONFIG_DIR;
    rmSync(dir, { recursive: true, force: true });
    rmSync(globalDir, { recursive: true, force: true });
  }
});

test('delegation: unlimited runs everything at once, a ceiling does not', async () => {
  const make = (n) =>
    Array.from({ length: n }, (_, i) => ({
      role: 'builder',
      sessionID: 's',
      directory: '.',
      config: defaultConfig(),
      project: { objective: 'concurrency', phase: 'EXECUTING', questions: [], decisions: [] },
      tasks: [],
      task: readyTask(`T-${i}`, `f${i}.ts`),
    }));

  let peak = 0;
  let live = 0;
  const host = {
    async catalogue() {
      return [];
    },
    async sessionModel() {
      return null;
    },
    async dispatch() {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 20));
      live -= 1;
      return { ok: true, text: 'ok' };
    },
  };

  await delegateMany(make(6), host, 2);
  assert.strictEqual(peak, 2, 'a ceiling of 2 never runs more than 2');

  peak = 0;
  await delegateMany(make(6), host, 0);
  assert.strictEqual(peak, 6, '0 means unlimited');
});

test('delegation: an offline host degrades instead of throwing', async () => {
  const dir = tmp('foundry-offline-');
  const globalDir = tmp('foundry-global-');
  process.env.OPENCODE_CONFIG_DIR = globalDir;
  try {
    const engine = createEngine(dir, { host: OFFLINE_HOST });
    engine.start('Offline');
    const result = await engine.delegateRole({
      role: 'architect',
      sessionID: 's',
      directory: dir,
      brief: 'anything',
    });
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /no OpenCode host/i);
  } finally {
    delete process.env.OPENCODE_CONFIG_DIR;
    rmSync(dir, { recursive: true, force: true });
    rmSync(globalDir, { recursive: true, force: true });
  }
});

/**
 * The setup question is mandatory once per conversation, and a project that is
 * already configured is not a reason to skip it — "keep as is" is one of the
 * three answers. Previously the tool told the orchestrator to move on whenever
 * the project had been configured before, so a returning session was never
 * asked.
 */
test('setup: every new conversation is asked, configured or not', async () => {
  const dir = tmp('foundry-gate-');
  const globalDir = tmp('foundry-global-');
  process.env.OPENCODE_CONFIG_DIR = globalDir;
  try {
    const { createFoundryTools } = await import(new URL(`file://${distDir}/tools/definitions.js`));
    const { SessionGate } = await import(new URL(`file://${distDir}/runtime/setup.js`));
    const host = recordingHost();
    const tools = createFoundryTools({ fallbackDir: dir, host, gate: new SessionGate() });
    const status = async (sessionID) =>
      JSON.parse(await tools.foundry_setup.execute({ action: 'status' }, { directory: dir, sessionID }));

    const first = await status('ses-1');
    assert.strictEqual(first.ask_now, true, 'a new conversation is greeted');
    assert.strictEqual(first.configured, false);
    assert.deepStrictEqual(
      Object.keys(first.options).sort(),
      ['configure', 'keep'],
      'exactly two answers: keep it, or open the window',
    );
    assert.match(first.next, /Wait for the answer/);

    const again = await status('ses-1');
    assert.strictEqual(again.ask_now, false, 'and only once in that conversation');
    assert.strictEqual(again.options, undefined, 'nothing offered when nothing is being asked');

    // Configure it, then arrive in a brand new conversation.
    await tools.foundry_setup.execute(
      { action: 'apply', choice: 'custom', builders: 2 },
      { directory: dir, sessionID: 'ses-1' },
    );
    const returning = await status('ses-2');
    assert.strictEqual(returning.configured, true);
    assert.strictEqual(returning.ask_now, true, 'a configured project is still asked in a new conversation');
    assert.strictEqual(returning.builders, 2, 'and the question shows what is in effect');
  } finally {
    delete process.env.OPENCODE_CONFIG_DIR;
    rmSync(dir, { recursive: true, force: true });
    rmSync(globalDir, { recursive: true, force: true });
  }
});
