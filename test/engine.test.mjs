import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');

const engineModule = await import(new URL(`file://${distDir}/tools/engine.js`));
const schemaModule = await import(new URL(`file://${distDir}/config/schema.js`));
const storeModule = await import(new URL(`file://${distDir}/core/store.js`));

const { createEngine } = engineModule;
const { defaultConfig } = schemaModule;
const { FoundryStore } = storeModule;

test('engine: full lifecycle works correctly', async (t) => {
  const projectDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-engine-'));
  const globalDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-global-'));
  try {
    process.env.OPENCODE_CONFIG_DIR = globalDir;
    const engine = createEngine(projectDir, { config: defaultConfig() });

    // Start a project
    const startResult = engine.start('Build a system');
    assert.strictEqual(startResult.created, true);
    assert.strictEqual(startResult.objective, 'Build a system');
    assert.strictEqual(startResult.phase, 'CLARIFYING');

    // Ask questions
    const askResult = engine.ask([
      { question: 'What database?', why: 'Need to know the backend' },
      { question: 'MFA required?', why: 'Affects complexity' },
    ]);
    assert.strictEqual(askResult.asked.length, 2);

    // Answer the questions
    const ansResult = engine.answer([
      { id: askResult.asked[0].id, answer: 'PostgreSQL' },
      { id: askResult.asked[1].id, answer: 'Yes' },
    ]);
    assert.strictEqual(ansResult.applied.length, 2);
    assert.strictEqual(ansResult.phase, 'PLANNING');

    // Submit a plan
    const planResult = engine.planSubmit({
      author: 'architect',
      scope: 'MVP',
      summary: 'Basic system',
      proposals: [
        {
          title: 'Database schema',
          objective: 'Create tables',
          ref: 'schema',
          allowed_files: ['migrations/**'],
          acceptance_criteria: ['Tables exist'],
        },
        {
          title: 'API endpoints',
          objective: 'Build API',
          depends_on: ['schema'],
          allowed_files: ['src/api/**'],
          acceptance_criteria: ['API works'],
        },
      ],
    });
    assert(planResult.plan, 'should have plan id');

    // Apply the plan
    const applyResult = engine.planApply(planResult.plan);
    assert(applyResult.created.length === 2);
    const taskIds = applyResult.created.map((t) => t.id);

    // Verify plan payloads are in .agent-foundry/plans/ and NOT in project.json
    const projectJsonPath = join(projectDir, '.agent-foundry', 'project.json');
    const projectContent = JSON.parse(readFileSync(projectJsonPath, 'utf8'));
    assert(!projectContent.proposals, 'project.json should not have proposals array');
    assert(Array.isArray(projectContent.plans), 'project.json should have compact plan refs');

    // Start the first task
    const startTaskResult = engine.taskStart(taskIds[0], 'builder');
    assert(startTaskResult.packet, 'should return a packet');
    const packetStr = JSON.stringify(startTaskResult.packet);
    assert(packetStr.length < 50000, 'packet should not be bloated');

    // Complete the first task
    const completeResult = engine.taskComplete(
      taskIds[0],
      {
        files_created: ['migrations/001.sql'],
        tests_executed: ['psql test'],
        test_result: 'pass',
      },
      'builder',
    );
    assert(completeResult.id === taskIds[0] || completeResult.task === taskIds[0]);

    // The second task's status changes after completion are processed
    // Call next to ensure propagation
    engine.next();
    const task2After = engine.taskShow(taskIds[1]);
    // Task should be either READY or PLANNED depending on review gates
    assert(['READY', 'REVIEW', 'PLANNED'].includes(task2After.status), `task status should be one of those, got ${task2After.status}`);

    // Check board
    const board = engine.board();
    assert(board.columns);
    // Board should have some columns
    assert(Object.keys(board.columns).length > 0, 'board should have columns');
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(globalDir, { recursive: true, force: true });
    delete process.env.OPENCODE_CONFIG_DIR;
  }
});

test('engine: taskUpdate refuses an anchored change', (t) => {
  const projectDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-engine-'));
  const globalDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-global-'));
  try {
    process.env.OPENCODE_CONFIG_DIR = globalDir;
    const engine = createEngine(projectDir, { config: defaultConfig() });
    engine.start('Test');

    const planResult = engine.planSubmit({
      author: 'architect',
      scope: 'Test',
      summary: 'Test',
      proposals: [
        {
          title: 'Task',
          objective: 'Do something',
          acceptance_criteria: ['Criterion 1'],
        },
      ],
    });
    engine.planApply(planResult.plan);

    const tasks = engine.taskList();
    const taskId = tasks.tasks[0].id;

    // Anchor a criterion
    engine.taskUpdate(taskId, { anchors: ['Criterion 1'] });

    // Try to remove the anchored criterion
    const result = engine.taskUpdate(taskId, { acceptance_criteria: [] });
    // Should have an error or rejection
    assert(result.refused || result.error, 'should reject removal of anchored criterion');
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(globalDir, { recursive: true, force: true });
    delete process.env.OPENCODE_CONFIG_DIR;
  }
});

test('engine: escalate blocks the task', (t) => {
  const projectDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-engine-'));
  const globalDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-global-'));
  try {
    process.env.OPENCODE_CONFIG_DIR = globalDir;
    const engine = createEngine(projectDir, { config: defaultConfig() });
    engine.start('Test');

    const planResult = engine.planSubmit({
      author: 'architect',
      scope: 'Test',
      summary: 'Test',
      proposals: [
        {
          title: 'Task',
          objective: 'Do something',
          allowed_files: ['test.txt'],
          acceptance_criteria: ['Done'],
        },
      ],
    });
    engine.planApply(planResult.plan);

    const tasks = engine.taskList();
    const taskId = tasks.tasks[0].id;

    const result = engine.escalate(taskId, 'builder', 'Too complex');
    // Escalation might return an object with task info or escalation details
    assert(result, 'escalation should return a result');

    // Task should now be BLOCKED
    const updated = engine.taskShow(taskId);
    assert.strictEqual(updated.status, 'BLOCKED');
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(globalDir, { recursive: true, force: true });
    delete process.env.OPENCODE_CONFIG_DIR;
  }
});

test('engine: doctor reports file overlaps', (t) => {
  const projectDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-engine-'));
  const globalDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-global-'));
  try {
    process.env.OPENCODE_CONFIG_DIR = globalDir;
    const engine = createEngine(projectDir, { config: defaultConfig() });
    engine.start('Test');

    const planResult = engine.planSubmit({
      author: 'architect',
      scope: 'Test',
      summary: 'Test',
      proposals: [
        { title: 'Task A', objective: 'Modify auth', allowed_files: ['src/auth.ts'] },
        { title: 'Task B', objective: 'Modify auth again', allowed_files: ['src/auth.ts'] },
      ],
    });
    engine.planApply(planResult.plan);

    const report = engine.doctor();
    assert(report.file_overlaps && report.file_overlaps.length > 0, 'should report file overlaps');
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(globalDir, { recursive: true, force: true });
    delete process.env.OPENCODE_CONFIG_DIR;
  }
});

/** Builds a two-task project where B depends on A. */
function twoTaskProject() {
  const projectDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-guard-'));
  const engine = createEngine(projectDir, { config: defaultConfig() });
  engine.start('Guard tests');
  engine.planSubmit({
    author: 'analyst',
    scope: 'guards',
    summary: 'B depends on A',
    proposals: [
      { ref: 'a', title: 'A', objective: 'first', allowed_files: ['a.ts'], acceptance_criteria: ['ok'] },
      { title: 'B', objective: 'second', allowed_files: ['b.ts'], acceptance_criteria: ['ok'], depends_on: ['a'] },
    ],
  });
  engine.planApply('PLAN-001');
  return { projectDir, engine };
}

/**
 * Regression: a status is not a free-form field.
 *
 * taskUpdate used to accept any transition, so a task could be moved to READY
 * with its dependencies unmet. The board would show it as runnable and then
 * taskStart would silently block it — a state the user could see but not act on.
 */
test('engine: taskUpdate refuses READY while dependencies are unmet', () => {
  const { projectDir, engine } = twoTaskProject();
  try {
    const refused = engine.taskUpdate('TASK-002', { status: 'READY' });
    assert.strictEqual(refused.refused, true, 'moving a blocked task to READY must be refused');
    assert.match(refused.reason, /TASK-001/, 'the refusal names the unmet dependency');
    assert.notStrictEqual(engine.taskShow('TASK-002').status, 'READY');

    const alsoRefused = engine.taskUpdate('TASK-002', { status: 'IN_PROGRESS' });
    assert.strictEqual(alsoRefused.refused, true, 'IN_PROGRESS is gated the same way');

    // Non-runnable columns stay freely settable: the gate is about runnability.
    const parked = engine.taskUpdate('TASK-002', { status: 'BACKLOG' });
    assert.strictEqual(parked.status, 'BACKLOG');
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('engine: taskUpdate allows READY once the dependency is satisfied', () => {
  const { projectDir, engine } = twoTaskProject();
  try {
    engine.taskStart('TASK-001');
    engine.taskComplete(
      'TASK-001',
      {
        files_created: ['a.ts'],
        commands_executed: ['npm test'],
        tests_executed: ['npm test'],
        test_result: 'pass',
      },
      'builder',
    );
    for (const gate of ['execution', 'test', 'review', 'architecture', 'acceptance']) {
      try {
        engine.review('TASK-001', gate, 'passed', 'analyst');
      } catch {
        /* gate not required for this task */
      }
    }
    assert.strictEqual(engine.taskShow('TASK-001').status, 'DONE');
    const updated = engine.taskUpdate('TASK-002', { status: 'READY' });
    assert.notStrictEqual(updated.refused, true);
    assert.strictEqual(engine.taskShow('TASK-002').status, 'READY');
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

/**
 * Regression: the event sequence cache must notice writes from another store.
 *
 * The engine creates a store per tool call and the bridge creates one per
 * request, so several instances point at the same log. A stale cache handed out
 * a sequence number that was already used, and the desktop stream then dropped
 * the event as a duplicate.
 */
test('store: interleaved store instances never reuse an event sequence number', () => {
  const projectDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-seq-'));
  try {
    const first = new FoundryStore(projectDir);
    first.init('Sequence test');

    const second = new FoundryStore(projectDir);

    // Interleave writes between two live instances.
    for (let i = 0; i < 5; i += 1) {
      first.appendEvent({ type: 'TASK_UPDATED', actor: 'orchestrator', message: `first ${i}` });
      second.appendEvent({ type: 'TASK_UPDATED', actor: 'orchestrator', message: `second ${i}` });
    }

    const events = second.readEvents(100);
    const sequences = events.map((event) => event.seq);
    assert.strictEqual(
      new Set(sequences).size,
      sequences.length,
      `duplicate sequence numbers: ${sequences.join(', ')}`,
    );
    assert.deepStrictEqual(
      sequences,
      [...sequences].sort((a, b) => a - b),
      'sequence numbers must be monotonically increasing',
    );
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

/**
 * Observed in a real run: the model passed the user's sentence still wrapped in
 * the quotes it had quoted it with, and the wrapper then appeared in the board
 * header, the desktop dashboard and every status report.
 */
test('engine: the stored objective is stripped of quote wrappers', () => {
  for (const [raw, expected] of [
    ['"Renomear fotos pela data"', 'Renomear fotos pela data'],
    ["'build a thing'", 'build a thing'],
    ['`build a thing`', 'build a thing'],
    ['  "  spaced  "  ', 'spaced'],
    ['a "quoted" word inside', 'a "quoted" word inside'],
    ['plain objective', 'plain objective'],
  ]) {
    const dir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-obj-'));
    try {
      const engine = createEngine(dir, { config: defaultConfig() });
      engine.start(raw);
      assert.strictEqual(engine.status().objective, expected, `input ${JSON.stringify(raw)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

/**
 * Observed in a real run: the architect submitted a plan, then submitted a
 * second one, and only the second was applied. The first was paid for in full
 * and produced nothing — the same waste the tic-tac-toe forensics found, where
 * four overlapping plans accumulated. Nothing warned about it.
 */
test('engine: a plan left unapplied is surfaced, not silently accumulated', () => {
  const dir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-plans-'));
  try {
    const engine = createEngine(dir, { config: defaultConfig() });
    engine.start('Two plans');

    const proposal = {
      title: 'A',
      objective: 'do it',
      allowed_files: ['a.ts'],
      acceptance_criteria: ['ok'],
    };

    const first = engine.planSubmit({ author: 'architect', scope: 'all', summary: 'v1', proposals: [proposal] });
    assert.ok(!first.warning, 'the first plan has nothing to warn about');

    const second = engine.planSubmit({ author: 'architect', scope: 'all', summary: 'v2', proposals: [proposal] });
    assert.ok(second.warning, 'submitting over an unapplied plan must warn');
    assert.deepStrictEqual(
      second.unapplied_plans.map((entry) => entry.split(' ')[0]),
      ['PLAN-001'],
    );

    // The doctor reports it too, so it surfaces even without a new submission.
    const before = engine.doctor();
    assert.ok(
      before.warnings.some((w) => w.includes('PLAN-001') && w.includes('never applied')),
      `doctor should flag the stranded plan: ${JSON.stringify(before.warnings)}`,
    );

    // Applying it clears the warning.
    engine.planApply('PLAN-001');
    const after = engine.doctor();
    assert.ok(!after.warnings.some((w) => w.includes('PLAN-001') && w.includes('never applied')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
