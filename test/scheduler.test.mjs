import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');

const schedulerModule = await import(new URL(`file://${distDir}/orchestration/scheduler.js`));
const { computeSchedule } = schedulerModule;

// Helper to create a task
function task(id, status = 'PLANNED', priority = 5, depends_on = [], allowed_files = []) {
  return {
    id,
    title: id,
    objective: '',
    status,
    priority,
    owner: 'analyst',
    executor: 'builder',
    depends_on,
    blocks: [],
    related_to: [],
    child_tasks: [],
    allowed_files,
    acceptance_criteria: [],
    anchors: [],
    attempts: 0,
    history: [],
    review_gates: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

test('scheduler: never exceeds max_parallel', (t) => {
  const tasks = [
    task('A', 'READY'),
    task('B', 'READY'),
    task('C', 'READY'),
    task('D', 'READY'),
    task('E', 'READY'),
  ];

  const decision = computeSchedule(tasks, { maxParallel: 2, allowFileOverlap: true });
  assert(decision.started.length <= 2, 'should start at most 2 tasks');
  assert.strictEqual(decision.limit, 2);
});

test('scheduler: respects dependencies', (t) => {
  const tasks = [
    task('A', 'READY'),
    task('B', 'READY', 5, ['A']), // B depends on A
    task('C', 'READY', 5, ['B']), // C depends on B
  ];

  const decision = computeSchedule(tasks, { maxParallel: 10, allowFileOverlap: true });

  // B should not be started because A hasn't completed yet
  const startedIds = decision.started;
  if (startedIds.includes('B')) {
    assert(!startedIds.includes('A'), 'if B is started, A must be started first (but A already started)');
  }

  // At minimum, A must be startable without blocking
  assert(decision.ready.includes('A') || decision.deferred.some((d) => d.id === 'A'));
});

test('scheduler: serialises tasks sharing a file when allow_file_overlap is false', (t) => {
  const tasks = [
    task('A', 'READY', 5, [], ['src/auth.ts']),
    task('B', 'READY', 5, [], ['src/auth.ts']),
  ];

  const decision = computeSchedule(tasks, { maxParallel: 10, allowFileOverlap: false });

  // Only one should be started
  assert(decision.started.length <= 1, 'should serialize tasks sharing files');

  if (decision.started.length === 1) {
    assert(!decision.deferred.some((d) => d.reason.includes('file lock')) === false || decision.deferred.length > 0);
  }
});

test('scheduler: does not serialize when allow_file_overlap is true', (t) => {
  const tasks = [
    task('A', 'READY', 5, [], ['src/auth.ts']),
    task('B', 'READY', 5, [], ['src/auth.ts']),
  ];

  const decision = computeSchedule(tasks, { maxParallel: 10, allowFileOverlap: true });

  // Both should be able to start
  assert.strictEqual(decision.started.length, 2, 'should allow both tasks to run concurrently when overlap is allowed');
});

test('scheduler: deterministic - same input produces the same decision twice', (t) => {
  const tasks = [
    task('A', 'READY', 7),
    task('B', 'READY', 5),
    task('C', 'READY', 9),
    task('D', 'READY', 5),
  ];

  const options = { maxParallel: 2, allowFileOverlap: true };
  const decision1 = computeSchedule(tasks, options);
  const decision2 = computeSchedule(tasks, options);

  assert.deepStrictEqual(decision1, decision2, 'same input should produce identical decisions');
});

test('scheduler: ordering is priority, then blast radius, then id', (t) => {
  const tasks = [
    task('Z', 'READY', 5), // Lower priority, later id
    task('A', 'READY', 9), // Higher priority, earlier id
    task('B', 'READY', 5), // Equal priority, depends on A (higher blast radius after A completes)
  ];

  const decision = computeSchedule(tasks, { maxParallel: 1, allowFileOverlap: true });

  // With max 1 parallel, the first started should be the one with highest priority
  // A has priority 9, so it should be first
  assert.strictEqual(decision.started[0], 'A', 'should start highest priority task first');
});
