#!/usr/bin/env node
/**
 * Seeds a realistic project and holds the bridge open so the desktop console
 * can be driven by hand — in the native window (--open) or in a browser page
 * pointed at the printed URL with `?url=&token=`.
 *
 * The scenario is a billing-service migration: enough tasks to populate every
 * interesting column, a real dependency chain with a critical path, one task
 * in review, one executing, and one failed attempt awaiting a retry.
 *
 * Run: node scripts/demo.mjs [--dir <path>] [--port <n>] [--open] [--configured]
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const url = (p) => `file:///${join(root, p).split('\\').join('/')}`;

const argOf = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const { createEngine } = await import(url('dist/tools/engine.js'));
const { DesktopBridge } = await import(url('dist/desktop/bridge.js'));
const { launch } = await import(url('dist/desktop/launcher.js'));
const { GATE_ORDER } = await import(url('dist/core/types.js'));

const dir = argOf('--dir') ?? mkdtempSync(join(tmpdir(), 'foundry-demo-'));

// A configured project opens the console on the dashboard; an unconfigured one
// opens it on the setup screen. Both are worth looking at.
if (process.argv.includes('--configured')) {
  writeFileSync(
    join(dir, 'agent-foundry.json'),
    `${JSON.stringify({ version: 2, configured: true, execution: { max_parallel: 4 } }, null, 2)}\n`,
  );
}

const engine = createEngine(dir);

engine.start('Migrate the billing service to an event-driven architecture with a zero-downtime cutover');
engine.ask([
  {
    question: 'Which message broker is approved for production: the shared Kafka cluster or the managed queue?',
    why: 'Determines the outbox publisher and the consumer implementation',
  },
  {
    question: 'Must the legacy REST contracts stay frozen until every consumer has migrated?',
    why: 'Decides whether a compatibility layer is in scope',
  },
  {
    question: 'What replication lag is acceptable before an invoice projection counts as stale?',
    why: 'Sets the reconciliation window and the alert thresholds',
  },
]);
engine.answer([
  { id: 'Q01', answer: 'The shared Kafka cluster operated by the platform team' },
  { id: 'Q02', answer: 'Yes. Contracts are frozen until the consumer migration completes' },
  { id: 'Q03', answer: 'Under 30 seconds at p99' },
]);

engine.planSubmit({
  author: 'architect',
  scope: 'whole project',
  summary:
    'Four modules: billing (outbox, projection, cutover), events (contracts, publisher), api (compatibility layer) and platform (observability, load test, runbook). The outbox and the event contracts come first; everything else hangs off them.',
  risks: [
    'Dual-write drift during cutover if reconciliation lags the write path',
    'Frozen REST contracts constrain the projection schema more than the event model does',
  ],
  proposals: [
    {
      ref: 'outbox',
      title: 'Add a transactional outbox to the billing schema',
      objective: 'Invoice writes and their outbox rows commit atomically, with a rollback-safe migration',
      module: 'billing',
      functionality: 'persistence',
      allowed_files: ['db/migrations/0042_billing_outbox.sql', 'src/billing/outbox/**'],
      acceptance_criteria: ['migration applies and rolls back cleanly', 'invoice write and outbox row commit in one transaction'],
      verification: 'npm test -- billing/outbox',
      priority: 9,
      owner: 'lead',
    },
    {
      ref: 'contracts',
      title: 'Define versioned billing event contracts',
      objective: 'Every billing event has a registered, versioned schema with a compatibility check',
      module: 'events',
      functionality: 'contracts',
      allowed_files: ['contracts/billing/*.avsc', 'src/events/schema/**'],
      acceptance_criteria: ['every event has a versioned schema', 'registry compatibility check passes'],
      verification: 'npm run contracts:check',
      priority: 9,
      owner: 'lead',
    },
    {
      ref: 'publisher',
      title: 'Publish outbox rows to Kafka with idempotent keys',
      objective: 'At-least-once delivery from the outbox to the billing topics, with lag exported as a metric',
      module: 'events',
      functionality: 'publisher',
      allowed_files: ['src/events/publisher/**'],
      acceptance_criteria: ['at-least-once delivery with idempotent keys', 'publisher lag exported as a metric'],
      verification: 'npm test -- events/publisher',
      depends_on: ['outbox', 'contracts'],
      priority: 8,
      owner: 'analyst',
    },
    {
      ref: 'projection',
      title: 'Consume invoice events into the ledger projection',
      objective: 'A projection that is idempotent under redelivery and rebuildable from offset zero',
      module: 'billing',
      functionality: 'projection',
      allowed_files: ['src/billing/projection/**'],
      acceptance_criteria: ['projection is idempotent under redelivery', 'rebuild from offset zero matches the ledger'],
      verification: 'npm test -- billing/projection',
      depends_on: ['publisher'],
      priority: 8,
      owner: 'analyst',
    },
    {
      ref: 'compat',
      title: 'Serve the frozen REST contracts from the projection',
      objective: 'Every legacy billing endpoint keeps its contract while reading from the projection',
      module: 'api',
      functionality: 'compatibility',
      allowed_files: ['src/api/billing/compat/**'],
      acceptance_criteria: ['contract tests pass for every frozen endpoint', 'responses are served from the projection'],
      verification: 'npm run test:contracts -- billing',
      depends_on: ['projection'],
      priority: 7,
      owner: 'analyst',
    },
    {
      ref: 'cutover',
      title: 'Dual-write toggle with a reconciliation report',
      objective: 'A flag switches the write path without a restart and every divergence is reported',
      module: 'billing',
      functionality: 'cutover',
      allowed_files: ['src/billing/cutover/**'],
      acceptance_criteria: ['flag switches the write path without restart', 'reconciliation report lists every divergence'],
      verification: 'npm test -- billing/cutover',
      depends_on: ['projection'],
      priority: 7,
      owner: 'analyst',
    },
    {
      ref: 'backfill',
      title: 'Backfill historical invoices into the outbox',
      objective: 'Historical invoices are replayed through the outbox within the lag budget',
      module: 'billing',
      functionality: 'backfill',
      allowed_files: ['scripts/backfill/**'],
      acceptance_criteria: ['replay stays under the 30 s p99 lag budget', 'replayed events are idempotent'],
      verification: 'npm test -- backfill',
      depends_on: ['outbox'],
      priority: 6,
      owner: 'analyst',
    },
    {
      ref: 'observability',
      title: 'Consumer lag and reconciliation dashboards',
      objective: 'Dashboards and alerts for outbox backlog, consumer lag and reconciliation drift',
      module: 'platform',
      functionality: 'observability',
      allowed_files: ['ops/dashboards/billing-events.json', 'ops/alerts/billing.yaml'],
      acceptance_criteria: ['lag alert fires above 30 s at p99', 'dashboard shows outbox backlog and reconciliation drift'],
      verification: 'npm run ops:validate',
      depends_on: ['contracts'],
      priority: 5,
      owner: 'analyst',
    },
    {
      ref: 'loadtest',
      title: 'Load test the event path at three times peak',
      objective: 'End-to-end latency and durability proven at three times peak traffic',
      module: 'platform',
      functionality: 'performance',
      allowed_files: ['perf/billing-events/**'],
      acceptance_criteria: ['p99 end-to-end latency under 30 s at 3x peak', 'no message loss across a broker restart'],
      verification: 'npm run perf -- billing-events',
      depends_on: ['compat', 'observability'],
      priority: 6,
      owner: 'analyst',
    },
    {
      title: 'Cutover runbook with rollback procedure',
      objective: 'Every cutover step has a verification and a rollback, reviewed by the on-call lead',
      module: 'platform',
      functionality: 'runbook',
      allowed_files: ['docs/runbooks/billing-cutover.md'],
      acceptance_criteria: ['every step has a verification and a rollback', 'reviewed by the on-call lead'],
      verification: 'npm run docs:lint',
      depends_on: ['cutover', 'loadtest'],
      priority: 4,
      owner: 'lead',
    },
  ],
});
engine.planApply('PLAN-001');

const attempt = (label, fn) => {
  try {
    return fn();
  } catch (error) {
    console.error(`  demo: ${label} — ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
};

const finish = (id, evidence) => {
  attempt(`start ${id}`, () => engine.taskStart(id, 'builder'));
  attempt(`complete ${id}`, () => engine.taskComplete(id, evidence, 'builder'));
};

const signOff = (id) => {
  for (const gate of GATE_ORDER) {
    try {
      engine.review(id, gate, 'passed', gate === 'architecture' || gate === 'acceptance' ? 'lead' : 'analyst', 'verified');
    } catch {
      /* gate not required for this task, or already decided */
    }
  }
};

// Two foundations done, the publisher waiting in review, dashboards executing,
// and the backfill failed once so the board shows a retry.
finish('TASK-001', {
  files_created: ['db/migrations/0042_billing_outbox.sql', 'src/billing/outbox/index.ts'],
  files_modified: ['src/billing/outbox/repository.ts'],
  commands_executed: ['npm run db:migrate', 'npm run db:rollback', 'npm run db:migrate'],
  tests_executed: ['npm test -- billing/outbox'],
  test_result: 'pass',
  output_summary: '18 assertions passed; migration applied and rolled back twice',
});
signOff('TASK-001');

finish('TASK-002', {
  files_created: ['contracts/billing/invoice-issued.v1.avsc', 'contracts/billing/invoice-settled.v1.avsc'],
  files_modified: ['src/events/schema/registry.ts'],
  commands_executed: ['npm run contracts:check'],
  tests_executed: ['npm run contracts:check'],
  test_result: 'pass',
  output_summary: '2 schemas registered, compatibility BACKWARD verified',
});
signOff('TASK-002');

finish('TASK-003', {
  files_created: ['src/events/publisher/outbox-publisher.ts', 'src/events/publisher/metrics.ts'],
  commands_executed: ['npm test -- events/publisher'],
  tests_executed: ['npm test -- events/publisher'],
  test_result: 'pass',
  output_summary: '11 assertions passed; redelivery test confirms idempotent keys',
});
attempt('review TASK-003', () => engine.review('TASK-003', 'execution', 'passed', 'analyst', 'evidence complete'));
attempt('review TASK-003', () => engine.review('TASK-003', 'test', 'passed', 'analyst', 'tests ran and passed'));

attempt('start TASK-008', () => engine.taskStart('TASK-008', 'builder'));

attempt('start TASK-007', () => engine.taskStart('TASK-007', 'builder'));
attempt('fail TASK-007', () =>
  engine.taskFail('TASK-007', 'Replay of 2.1M invoices exceeded the 30 s lag budget on the staging replica', 'builder'),
);

const bridge = new DesktopBridge({ projectDir: dir, port: Number(argOf('--port') ?? 0) });
const info = await bridge.start();

const status = engine.status();
console.log('\n  Agent Foundry demo bridge\n');
console.log(`  project   ${dir}`);
console.log(`  url       ${info.url}`);
console.log(`  token     ${info.token}`);
console.log(`  tasks     ${status.totals.tasks} · ${status.progress.percent}% done`);
console.log('  Ctrl+C to stop.\n');

if (process.argv.includes('--open')) {
  const result = launch({ directory: dir, root });
  console.log(`  window: ${result.status}${result.detail ? ` — ${result.detail}` : ''}\n`);
}

const shutdown = async () => {
  await bridge.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
setInterval(() => {}, 1 << 30);
