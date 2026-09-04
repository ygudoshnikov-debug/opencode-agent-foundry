import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const { createEngine } = await import(new URL(`file://${distDir}/tools/engine.js`));

/**
 * Ordering guards.
 *
 * The flow used to be enforced only by the orchestrator's prompt. A model that
 * lost the thread — or a second surface driving the same board — could record
 * evidence for work that never ran, review a task still in flight, or apply a
 * plan while its own questions sat unanswered. Each of those leaves a board
 * that reports something that did not happen, which is worse than an error:
 * the run continues on top of a lie.
 */

function withProject(fn) {
  const dir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-guard-'));
  const globalDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-global-'));
  process.env.OPENCODE_CONFIG_DIR = globalDir;
  try {
    return fn(dir);
  } finally {
    delete process.env.OPENCODE_CONFIG_DIR;
    rmSync(dir, { recursive: true, force: true });
    rmSync(globalDir, { recursive: true, force: true });
  }
}

const PLAN = {
  author: 'analyst',
  scope: 'guards',
  summary: 'one task',
  proposals: [
    {
      title: 'Do it',
      objective: 'done',
      allowed_files: ['src/a.ts'],
      acceptance_criteria: ['works'],
      verification: 'npm test',
    },
  ],
};

const EVIDENCE = {
  files_modified: ['src/a.ts'],
  tests_executed: ['npm test'],
  test_result: 'pass',
  summary: 'did it',
};

/** Drives a project to the point where TASK-001 exists and is READY. */
function plannedProject(dir) {
  const engine = createEngine(dir);
  engine.start('Guarded run');
  engine.planSubmit(PLAN);
  engine.planApply('PLAN-001');
  return engine;
}

test('guard: a plan cannot be applied while a question is unanswered', () => {
  withProject((dir) => {
    const engine = createEngine(dir);
    engine.start('Guarded run');
    engine.ask([{ question: 'Which database?', why: 'changes the schema' }]);
    engine.planSubmit(PLAN);

    assert.throws(() => engine.planApply('PLAN-001'), /unanswered/i);

    engine.answer([{ id: 'Q01', answer: 'postgres' }]);
    const applied = engine.planApply('PLAN-001');
    assert.strictEqual(applied.created.length, 1, 'answering unblocks the plan');
  });
});

test('guard: execution refuses before a plan has produced tasks', () => {
  withProject((dir) => {
    const engine = createEngine(dir);
    engine.start('Guarded run');
    engine.ask([{ question: 'Which database?', why: 'changes the schema' }]);

    // CLARIFYING: the answer is still outstanding.
    assert.throws(() => engine.next(), /still CLARIFYING/);

    engine.answer([{ id: 'Q01', answer: 'postgres' }]);
    // PLANNING: nothing has been planned yet, so there is nothing to run.
    assert.throws(() => engine.next(), /still PLANNING/);

    engine.planSubmit(PLAN);
    engine.planApply('PLAN-001');
    assert.ok(engine.next(), 'once tasks exist, scheduling proceeds');
  });
});

test('guard: executeReady refuses in the same states as next', async () => {
  const dir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-guard-'));
  const globalDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-global-'));
  process.env.OPENCODE_CONFIG_DIR = globalDir;
  try {
    const engine = createEngine(dir);
    engine.start('Guarded run');
    await assert.rejects(
      () => engine.executeReady({ sessionID: 's', directory: dir }),
      /Nothing to execute yet/,
    );
  } finally {
    delete process.env.OPENCODE_CONFIG_DIR;
    rmSync(dir, { recursive: true, force: true });
    rmSync(globalDir, { recursive: true, force: true });
  }
});

test('guard: evidence cannot be recorded for work that never started', () => {
  withProject((dir) => {
    const engine = plannedProject(dir);

    assert.throws(() => engine.taskComplete('TASK-001', EVIDENCE, 'builder'), /READY, not IN_PROGRESS/);

    engine.taskStart('TASK-001');
    const done = engine.taskComplete('TASK-001', EVIDENCE, 'builder');
    assert.strictEqual(done.status, 'REVIEW');

    // And not a second time: it is in REVIEW now, not IN_PROGRESS.
    assert.throws(() => engine.taskComplete('TASK-001', EVIDENCE, 'builder'), /waiting on review/);
  });
});

test('guard: a task that never ran cannot be failed', () => {
  withProject((dir) => {
    const engine = plannedProject(dir);
    assert.throws(() => engine.taskFail('TASK-001', 'broke', 'builder'), /READY, not IN_PROGRESS/);

    engine.taskStart('TASK-001');
    const failed = engine.taskFail('TASK-001', 'broke', 'builder');
    assert.strictEqual(failed.status, 'FAILED');
  });
});

test('guard: review only applies to a task that reported evidence', () => {
  withProject((dir) => {
    const engine = plannedProject(dir);

    assert.throws(() => engine.review('TASK-001', 'execution', 'passed', 'analyst'), /READY, not REVIEW/);

    engine.taskStart('TASK-001');
    assert.throws(
      () => engine.review('TASK-001', 'execution', 'passed', 'analyst'),
      /IN_PROGRESS, not REVIEW/,
      'a task still running cannot be reviewed',
    );

    engine.taskComplete('TASK-001', EVIDENCE, 'builder');
    let reviewed = engine.review('TASK-001', 'execution', 'passed', 'analyst');
    // Whatever gates the task requires, the last one closes it.
    while (reviewed.pending_gates.length) {
      reviewed = engine.review('TASK-001', reviewed.pending_gates[0], 'passed', 'analyst');
    }
    assert.strictEqual(reviewed.status, 'DONE');

    assert.throws(
      () => engine.review('TASK-001', 'execution', 'passed', 'analyst'),
      /gates already passed/,
      'a finished task is not reviewed again',
    );
  });
});

test('guard: a rejected review sends the task back and it can be completed again', () => {
  withProject((dir) => {
    const engine = plannedProject(dir);
    engine.taskStart('TASK-001');
    engine.taskComplete('TASK-001', EVIDENCE, 'builder');

    const rejected = engine.review('TASK-001', 'execution', 'rejected', 'analyst', 'missing a test');
    assert.strictEqual(rejected.status, 'IN_PROGRESS', 'rejection returns it to the builder');

    // The guard must not trap the rework loop it exists to protect.
    const redone = engine.taskComplete('TASK-001', EVIDENCE, 'builder');
    assert.strictEqual(redone.status, 'REVIEW');
  });
});

test('guard: refusals name the state and the call that fixes it', () => {
  withProject((dir) => {
    const engine = plannedProject(dir);
    try {
      engine.taskComplete('TASK-001', EVIDENCE, 'builder');
      assert.fail('should have refused');
    } catch (error) {
      assert.match(error.message, /TASK-001/, 'names the task');
      assert.match(error.message, /READY/, 'names the state it is actually in');
      assert.match(error.message, /foundry_execute/, 'names the call that fixes it');
    }
  });
});
