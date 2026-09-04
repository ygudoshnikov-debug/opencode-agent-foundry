import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');

const validatorModule = await import(new URL(`file://${distDir}/orchestration/validator.js`));
const graphModule = await import(new URL(`file://${distDir}/core/graph.js`));

const { validateCompletion, requiredGatesFor, anchorViolations, decideOnFailure } = validatorModule;
const { WorkGraph } = graphModule;

// Helper to create a task
function task(id, allowed_files = [], anchors = []) {
  return {
    id,
    title: id,
    objective: '',
    status: 'REVIEW',
    priority: 5,
    owner: 'analyst',
    executor: 'builder',
    depends_on: [],
    blocks: [],
    related_to: [],
    child_tasks: [],
    allowed_files,
    acceptance_criteria: ['Criterion 1'],
    anchors,
    attempts: 0,
    history: [],
    review_gates: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

test('validator: completion is refused with no evidence', (t) => {
  const taskObj = task('A');
  const graph = new WorkGraph([taskObj]);

  const result = validateCompletion(taskObj, undefined, graph);
  assert.strictEqual(result.ok, false);
  assert(result.reasons.some((r) => r.includes('evidence')));
});

test('validator: completion is refused with no tests', (t) => {
  const taskObj = task('A');
  const graph = new WorkGraph([taskObj]);

  const result = validateCompletion(taskObj, { files_created: ['file.ts'], tests_executed: [] }, graph);
  assert.strictEqual(result.ok, false);
  assert(result.reasons.some((r) => r.includes('no tests')));
});

test('validator: completion is refused with test_result fail', (t) => {
  const taskObj = task('A');
  const graph = new WorkGraph([taskObj]);

  const result = validateCompletion(
    taskObj,
    {
      files_created: ['file.ts'],
      tests_executed: ['npm test'],
      test_result: 'fail',
    },
    graph,
  );
  assert.strictEqual(result.ok, false);
  assert(result.reasons.some((r) => r.includes('tests failed')));
});

test('validator: completion is refused with test_result pass but EMPTY tests_executed list', (t) => {
  const taskObj = task('A');
  const graph = new WorkGraph([taskObj]);

  const result = validateCompletion(
    taskObj,
    {
      files_created: ['file.ts'],
      tests_executed: [],
      test_result: 'pass',
    },
    graph,
  );
  assert.strictEqual(result.ok, false);
  assert(result.reasons.some((r) => r.includes('no tests')));
});

test('validator: completion is refused when files fall outside allowed_files', (t) => {
  const taskObj = task('A', ['src/auth/**']);
  const graph = new WorkGraph([taskObj]);

  const result = validateCompletion(
    taskObj,
    {
      files_created: ['src/auth/login.ts', 'src/models/user.ts'], // user.ts is outside allowed
      tests_executed: ['npm test'],
      test_result: 'pass',
    },
    graph,
  );
  assert.strictEqual(result.ok, false);
  assert(result.reasons.some((r) => r.includes('outside allowed_files')));
});

test('validator: completion is ACCEPTED when files match a glob pattern like "src/auth/**"', (t) => {
  const taskObj = task('A', ['src/auth/**', 'tests/**']);
  const graph = new WorkGraph([taskObj]);

  const result = validateCompletion(
    taskObj,
    {
      files_created: ['src/auth/login.ts', 'src/auth/session.ts', 'tests/auth.test.ts'],
      tests_executed: ['npm test'],
      test_result: 'pass',
    },
    graph,
  );
  assert.strictEqual(result.ok, true);
});

test('validator: requiredGatesFor adds architecture at blast radius >= 3', (t) => {
  const task1 = task('A');
  const task2 = task('B', [], []);
  const task3 = task('C', [], []);
  const task4 = task('D', [], []);
  task2.depends_on = ['A'];
  task3.depends_on = ['A'];
  task4.depends_on = ['A'];

  const gates = requiredGatesFor(task1, 3, false);
  assert(gates.includes('architecture'), 'should include architecture for blast radius >= 3');
});

test('validator: requiredGatesFor adds acceptance at >= 5 or with anchors', (t) => {
  const taskWithAnchor = task('X', [], ['Criterion 1']);
  const gates = requiredGatesFor(taskWithAnchor, 1, false);
  assert(gates.includes('acceptance'), 'should include acceptance for tasks with anchors');
});

test('validator: anchorViolations refuses removing an anchored acceptance criterion', (t) => {
  const taskObj = task('A', [], ['Criterion 1', 'Criterion 2']);
  taskObj.acceptance_criteria = ['Criterion 1', 'Criterion 2'];

  const patch = { acceptance_criteria: ['Criterion 2'] }; // Removed Criterion 1

  const violations = anchorViolations(taskObj, patch);
  assert(violations.length > 0);
  assert(violations[0].includes('removes anchored'));
});

test('validator: decideOnFailure returns retry -> escalate -> block in that order', (t) => {
  const taskObj = task('A');

  // First attempt: should retry
  taskObj.attempts = 1;
  let decision = decideOnFailure(taskObj, 2); // maxRetries = 2
  assert.strictEqual(decision.decision, 'retry');

  // After max retries exhausted: should escalate
  taskObj.attempts = 3;
  taskObj.escalation = undefined;
  decision = decideOnFailure(taskObj, 2);
  assert.strictEqual(decision.decision, 'escalate');

  // After escalation attempted: should block
  taskObj.escalation = {
    from: 'builder',
    to: 'analyst',
    reason: 'too many failures',
    at: new Date().toISOString(),
  };
  decision = decideOnFailure(taskObj, 2);
  assert.strictEqual(decision.decision, 'block');
});
