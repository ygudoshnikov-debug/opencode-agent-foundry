#!/usr/bin/env node
/**
 * Seeds a realistic project and holds the bridge open so the UI can be driven
 * by hand — either in the native window (--open) or, for a quick visual check,
 * in a page pointed at the printed URL.
 *
 * Run: node scripts/demo.mjs [--dir <path>] [--port <n>] [--open]
 */
import { mkdtempSync } from 'node:fs';
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

const dir = argOf('--dir') ?? mkdtempSync(join(tmpdir(), 'foundry-demo-'));
const engine = createEngine(dir);

engine.start('Ship a task-tracking web app with authentication and a public API');
engine.ask([
  { question: 'Which database should the API use?', why: 'Changes the schema and the deployment' },
  { question: 'Do you need social login, or is email and password enough?', why: 'Changes the auth surface' },
]);
engine.answer([
  { id: 'Q01', answer: 'Postgres' },
  { id: 'Q02', answer: 'Email and password only for now' },
]);

engine.planSubmit({
  author: 'architect',
  scope: 'whole project',
  summary: 'Three modules: auth, api, ui. Auth first — everything else depends on its contract.',
  risks: ['Session handling is the main source of rework if the contract changes late'],
  proposals: [
    {
      ref: 'schema',
      title: 'Define the database schema',
      objective: 'Users, sessions and tasks, with migrations',
      module: 'auth',
      functionality: 'persistence',
      allowed_files: ['db/schema.sql', 'db/migrations/**'],
      acceptance_criteria: ['migrations apply cleanly', 'schema documented'],
      verification: 'npm run db:migrate && npm test -- db',
      priority: 9,
      owner: 'lead',
    },
    {
      ref: 'auth',
      title: 'Implement email and password auth',
      objective: 'Register, log in, log out, session cookie',
      module: 'auth',
      functionality: 'login',
      allowed_files: ['src/auth/**'],
      acceptance_criteria: ['a wrong password is rejected', 'sessions expire'],
      verification: 'npm test -- auth',
      depends_on: ['schema'],
      priority: 8,
      owner: 'analyst',
    },
    {
      ref: 'api',
      title: 'Build the task API',
      objective: 'CRUD over tasks, authenticated',
      module: 'api',
      functionality: 'tasks',
      allowed_files: ['src/api/**'],
      acceptance_criteria: ['unauthenticated requests get 401', 'CRUD round-trips'],
      verification: 'npm test -- api',
      depends_on: ['auth'],
      priority: 7,
      owner: 'analyst',
    },
    {
      title: 'Build the task list UI',
      objective: 'List, create and complete tasks',
      module: 'ui',
      functionality: 'list',
      allowed_files: ['src/ui/**'],
      acceptance_criteria: ['tasks render', 'completing one persists'],
      verification: 'npm test -- ui',
      depends_on: ['api'],
      priority: 6,
      owner: 'analyst',
    },
    {
      title: 'Document the public API',
      objective: 'OpenAPI description of every endpoint',
      module: 'api',
      functionality: 'docs',
      allowed_files: ['docs/api.md'],
      acceptance_criteria: ['every endpoint documented'],
      depends_on: ['api'],
      priority: 3,
      owner: 'analyst',
    },
  ],
});
engine.planApply('PLAN-001');

// Drive tasks through an honest lifecycle so the board shows something in
// every interesting column.
engine.taskStart('TASK-001', 'builder');
engine.taskComplete(
  'TASK-001',
  {
    files_created: ['db/schema.sql'],
    files_modified: ['db/migrations/001_init.sql'],
    commands_executed: ['npm run db:migrate'],
    tests_executed: ['npm test -- db'],
    test_result: 'pass',
    output_summary: '12 assertions passed',
  },
  'builder',
);
for (const gate of ['review', 'architecture', 'acceptance']) {
  try {
    engine.review('TASK-001', gate, 'passed', 'analyst', 'looks right');
  } catch {
    /* gate not required for this task */
  }
}
engine.taskStart('TASK-002', 'builder');
engine.taskFail('TASK-003', 'blocked on the auth contract', 'builder');
engine.escalate('TASK-003', 'builder', 'session shape is undecided');

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
