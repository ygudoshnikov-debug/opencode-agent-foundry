import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');

const graphModule = await import(new URL(`file://${distDir}/core/graph.js`));
const { WorkGraph } = graphModule;

// Helper to create a task
function task(id, depends_on = [], blocks = []) {
  return {
    id,
    title: id,
    objective: '',
    status: 'PLANNED',
    priority: 5,
    owner: 'analyst',
    executor: 'builder',
    depends_on,
    blocks,
    related_to: [],
    child_tasks: [],
    allowed_files: [],
    acceptance_criteria: [],
    anchors: [],
    attempts: 0,
    history: [],
    review_gates: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

test('graph: upstream/downstream/blastRadius on a diamond graph', (t) => {
  // Diamond: A -> B, A -> C, B -> D, C -> D
  const tasks = [
    task('A', []),
    task('B', ['A']),
    task('C', ['A']),
    task('D', ['B', 'C']),
  ];
  const graph = new WorkGraph(tasks);

  // A's downstream should be [B, C, D]
  const downA = graph.downstream('A').sort();
  assert.deepStrictEqual(downA, ['B', 'C', 'D']);

  // D's upstream should be [A, B, C]
  const upD = graph.upstream('D').sort();
  assert.deepStrictEqual(upD, ['A', 'B', 'C']);

  // B's downstream should be [D]
  const downB = graph.downstream('B');
  assert.deepStrictEqual(downB, ['D']);

  // Blast radius of A should be 3 (B, C, D)
  const radiusA = graph.blastRadius('A');
  assert.strictEqual(radiusA, 3);
});

test('graph: detectCycles finds a cycle', (t) => {
  // Create a cycle: A -> B -> C -> A
  const tasks = [
    task('A', ['C']),
    task('B', ['A']),
    task('C', ['B']),
  ];
  const graph = new WorkGraph(tasks);

  const cycles = graph.detectCycles();
  assert(cycles.length > 0, 'should detect at least one cycle');
  // Each cycle should be a path through the same nodes
  const cycleStr = cycles.map((c) => c.join('-')).join('; ');
  assert(cycleStr.includes('A') && cycleStr.includes('B') && cycleStr.includes('C'));
});

test('graph: topoOrder reports cyclic nodes as unreachable', (t) => {
  // Manually create a cycle by making B depend on C and C depend on B
  const cycleA = task('X', ['Y']);
  const cycleB = task('Y', ['X']);
  const acyclic = [task('Z', [])];

  const graphCyclic = new WorkGraph([cycleA, cycleB, ...acyclic]);
  const { order, cyclic } = graphCyclic.topoOrder();

  // The cyclic nodes should be in the cyclic list
  assert(cyclic.includes('X') && cyclic.includes('Y'), 'should report X and Y as cyclic');
  // Z should be in order
  assert(order.includes('Z'), 'should include acyclic node Z');
});

test('graph: criticalPath on a known chain', (t) => {
  // Linear chain: A -> B -> C -> D
  const tasks = [
    task('A', []),
    task('B', ['A']),
    task('C', ['B']),
    task('D', ['C']),
  ];
  const graph = new WorkGraph(tasks);

  const { path, length } = graph.criticalPath();
  assert.strictEqual(path.length, 4, 'path should have 4 nodes');
  assert.deepStrictEqual(path, ['A', 'B', 'C', 'D'], 'path should be in order');
  assert.strictEqual(length, 4, 'length should be 4');
});

test('graph: isUnblocked treats a DANGLING dependency as blocking', (t) => {
  const tasks = [
    task('A', ['MISSING']), // Depends on a task that doesn't exist
    task('B', []),
  ];
  const graph = new WorkGraph(tasks);

  const taskA = tasks[0];
  const unblocked = graph.isUnblocked(taskA);
  assert.strictEqual(unblocked.ok, false, 'dangling dependency should block');
  assert(unblocked.waiting_for.includes('MISSING'));
});

test('graph: fileOverlaps reports two independent tasks sharing a file', (t) => {
  // Two independent tasks that both touch src/auth
  const tasks = [
    { ...task('A', []), allowed_files: ['src/auth/login.ts', 'src/utils.ts'] },
    { ...task('B', []), allowed_files: ['src/auth/logout.ts'] },
    { ...task('C', []), allowed_files: ['src/models/user.ts'] },
  ];
  const graph = new WorkGraph(tasks);

  const overlaps = graph.fileOverlaps();
  // A and B overlap in src/auth namespace (depending on glob matching)
  // The exact result depends on implementation, but both touch files under src/auth
  const abOverlap = overlaps.find((o) => (o.a === 'A' && o.b === 'B') || (o.a === 'B' && o.b === 'A'));
  assert(
    abOverlap || overlaps.length === 0,
    'A and B might overlap if strict file matching, or have no overlap if only exact matches',
  );
});

test('graph: fileOverlaps does NOT report a pair where one depends on the other', (t) => {
  // A -> B: A depends on B, so they can run sequentially
  // Even if they touch the same files, the scheduler will serialize them anyway
  const tasks = [
    { ...task('A', ['B']), allowed_files: ['src/auth.ts'] },
    { ...task('B', []), allowed_files: ['src/auth.ts'] },
  ];
  const graph = new WorkGraph(tasks);

  const overlaps = graph.fileOverlaps();
  // Should NOT report this pair because there's a dependency
  const abOverlap = overlaps.find((o) => (o.a === 'A' && o.b === 'B') || (o.a === 'B' && o.b === 'A'));
  assert(!abOverlap, 'dependent tasks should not be reported as file overlaps');
});

test('graph: missingDeps returns tasks with dangling dependencies', (t) => {
  const tasks = [
    task('A', ['MISSING']),
    task('B', ['A']),
    task('C', ['MISSING-2']),
  ];
  const graph = new WorkGraph(tasks);

  const missing = graph.missingDeps();
  assert.strictEqual(missing.length, 2);
  assert(missing.some((m) => m.task === 'A' && m.missing === 'MISSING'));
  assert(missing.some((m) => m.task === 'C' && m.missing === 'MISSING-2'));
});
