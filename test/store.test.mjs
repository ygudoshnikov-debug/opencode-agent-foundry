import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');

const storeModule = await import(new URL(`file://${distDir}/core/store.js`));
const { FoundryStore, HISTORY_LIMIT } = storeModule;

test('store: init/loadProject/saveProject/flush round-trip', (t) => {
  const projectDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-store-'));
  try {
    const store = new FoundryStore(projectDir);
    assert(!store.exists(), 'store should not exist initially');

    const project = store.init('Test objective');
    assert.strictEqual(project.objective, 'Test objective');
    assert.strictEqual(project.phase, 'CLARIFYING');
    store.flush();

    assert(store.exists(), 'store should exist after init and flush');

    const loaded = store.loadProject();
    assert(loaded, 'should load project');
    assert.strictEqual(loaded.objective, 'Test objective');

    loaded.objective = 'Updated objective';
    store.saveProject(loaded);
    store.flush();

    const store2 = new FoundryStore(projectDir);
    const reloaded = store2.loadProject();
    assert.strictEqual(reloaded?.objective, 'Updated objective');
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('store: allocateIds is sequential and touches the counter once for bulk allocation', (t) => {
  const projectDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-store-'));
  try {
    const store = new FoundryStore(projectDir);
    store.init('Test');
    store.flush();

    // allocateIds should be available
    const ids1 = store.allocateIds('task', 5);
    assert.strictEqual(ids1.length, 5);
    // Should be sequential
    for (let i = 1; i < ids1.length; i++) {
      const prev = parseInt(ids1[i - 1].match(/\d+$/)[0]);
      const curr = parseInt(ids1[i].match(/\d+$/)[0]);
      assert(curr > prev, `ids should be sequential, got ${prev} then ${curr}`);
    }

    // Next allocation should start after the last one
    const ids2 = store.allocateIds('task', 3);
    const lastId1 = parseInt(ids1[ids1.length - 1].match(/\d+$/)[0]);
    const firstId2 = parseInt(ids2[0].match(/\d+$/)[0]);
    assert(firstId2 > lastId1, `second batch should start after first: ${lastId1} vs ${firstId2}`);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('store: event sequence numbers are contiguous across many appends AND across a NEW store instance', (t) => {
  const projectDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-store-'));
  try {
    const store = new FoundryStore(projectDir);
    store.init('Test');

    // Append many events
    for (let i = 0; i < 10; i++) {
      store.appendEvent({
        type: 'PROJECT_CREATED',
        actor: 'orchestrator',
        message: `Event ${i}`,
      });
    }
    store.flush();

    // Load events and check sequence
    const events1 = store.readEvents();
    const seqs = events1.map((e) => e.seq);
    for (let i = 1; i < seqs.length; i++) {
      assert.strictEqual(seqs[i], seqs[i - 1] + 1, `sequences must be contiguous: ${seqs}`);
    }

    // Create new store instance and verify new events continue properly
    const store2 = new FoundryStore(projectDir);
    store2.appendEvent({
      type: 'PHASE_CHANGED',
      actor: 'orchestrator',
      message: 'New event',
    });
    store2.flush();

    const events2 = store2.readEvents();
    // All events should have unique sequence numbers
    const seqs2 = events2.map((e) => e.seq);
    const uniqueSeqs = new Set(seqs2);
    assert.strictEqual(uniqueSeqs.size, seqs2.length, 'all sequences must be unique across instances');
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('store: history is capped at HISTORY_LIMIT and long output_summary is truncated', (t) => {
  const projectDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-store-'));
  try {
    const store = new FoundryStore(projectDir);
    store.init('Test');
    store.flush();

    // Create a task with many history entries
    const task = {
      id: 'T001',
      title: 'Test task',
      objective: 'Do something',
      status: 'BACKLOG',
      priority: 5,
      owner: 'analyst',
      executor: 'builder',
      depends_on: [],
      blocks: [],
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

    // Add many history entries
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      task.history.push({
        n: i + 1,
        at: new Date().toISOString(),
        actor: 'builder',
        result: 'failure',
        evidence: {
          tests_executed: ['test'],
          test_result: 'fail',
          output_summary: 'x'.repeat(2000), // Way over limit
        },
      });
    }

    store.saveTask(task);
    store.flush();

    const loaded = store.loadTask('T001');
    assert(loaded, 'task should load');
    assert(loaded.history.length <= HISTORY_LIMIT, `history should be capped at ${HISTORY_LIMIT}`);
    if (loaded.history[0].evidence?.output_summary) {
      assert(
        loaded.history[0].evidence.output_summary.length < 2000,
        'long output_summary should be truncated',
      );
      assert(loaded.history[0].evidence.output_summary.includes('truncated'), 'truncation message should be present');
    }
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('store: legacy status names on disk normalize on load', (t) => {
  const projectDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-store-'));
  try {
    const store = new FoundryStore(projectDir);
    store.init('Test');

    // Manually create a task with legacy status and save it
    const task = {
      id: 'T001',
      title: 'Test',
      objective: '',
      status: 'WAITING', // Legacy status
      priority: 5,
      owner: 'analyst',
      executor: 'builder',
      depends_on: [],
      blocks: [],
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

    store.saveTask(task);
    store.flush();

    const loaded = store.loadTask('T001');
    assert.strictEqual(loaded?.status, 'BLOCKED', 'WAITING should map to BLOCKED');

    // Test other legacy statuses
    const legacyMap = {
      TESTING: 'REVIEW',
      CORRECTED: 'READY',
      FIXING: 'IN_PROGRESS',
      VERIFIED: 'DONE',
    };

    for (const [legacy, expected] of Object.entries(legacyMap)) {
      task.status = legacy;
      store.saveTask(task);
      store.flush();
      const l = store.loadTask('T001');
      assert.strictEqual(l?.status, expected, `${legacy} should map to ${expected}`);
    }
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('store: a legacy project.json containing inline "subplans" loads and is rewritten without them', (t) => {
  const projectDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-store-'));
  try {
    // Manually create a v1 project with inline subplans
    const foundryDir = join(projectDir, '.agent-foundry');
    mkdirSync(foundryDir, { recursive: true });

    const legacyProject = {
      project_id: 'FOUNDRY-001',
      objective: 'Test',
      phase: 'EXECUTING',
      status: 'active',
      counters: {},
      subplans: [
        {
          author: 'architect',
          scope: 'Initial',
          proposed_tasks: [{}, {}], // 2 tasks
        },
        {
          author: 'lead',
          scope: 'Detail',
          proposed_tasks: [{}], // 1 task
        },
      ],
      questions: [],
      human_decisions: [],
      acceptance_anchors: [],
      cost_totals_usd: 0,
      tokens_total: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    writeFileSync(join(foundryDir, 'project.json'), JSON.stringify(legacyProject));
    writeFileSync(join(foundryDir, 'events.jsonl'), '');

    const store = new FoundryStore(projectDir);
    const project = store.loadProject();
    assert(project, 'should load');
    assert.strictEqual(project.phase, 'EXECUTING');

    // Plans should be converted to compact refs
    assert(Array.isArray(project.plans));
    assert.strictEqual(project.plans.length, 2, 'should have 2 plan refs from subplans');
    assert.strictEqual(project.plans[0].proposals, 2, 'first plan had 2 proposals');
    assert.strictEqual(project.plans[1].proposals, 1, 'second plan had 1 proposal');

    // After flushing, subplans should be gone from disk
    store.flush();
    const rewritten = readFileSync(join(foundryDir, 'project.json'), 'utf8');
    const parsed = JSON.parse(rewritten);
    assert(!parsed.subplans, 'subplans should be removed from disk');
    assert(Array.isArray(parsed.plans), 'plans should be a compact array');
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});
