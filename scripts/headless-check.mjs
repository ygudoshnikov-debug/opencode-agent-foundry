#!/usr/bin/env node
/**
 * Proves the plugin is fully usable with no desktop layer at all.
 *
 * The desktop window is an addition, not a dependency: with `desktop.enabled`
 * false — or with the native binary simply not built — the plugin must load,
 * register everything, run a task lifecycle, bind no port, and shut down
 * without throwing.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const distUrl = `file:///${join(root, 'dist', 'index.js').split('\\').join('/')}`;

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const plugin = await import(distUrl);
const dir = mkdtempSync(join(tmpdir(), 'foundry-headless-'));
// Isolate from the developer's real global configuration.
const configHome = mkdtempSync(join(tmpdir(), 'foundry-cfg-'));
process.env.OPENCODE_CONFIG_DIR = configHome;

console.log('\n=== Agent Foundry headless check ===\n');

try {
  writeFileSync(join(dir, 'agent-foundry.json'), JSON.stringify({ desktop: { enabled: false } }));

  const hooks = await plugin.default.server({
    directory: dir,
    client: {},
    project: {},
    worktree: dir,
    serverUrl: new URL('http://127.0.0.1:1'),
    $: {},
  });

  check('plugin loads with the desktop disabled', Boolean(hooks));
  check('tools are registered', Object.keys(hooks.tool ?? {}).length >= 19, `${Object.keys(hooks.tool ?? {}).length} tools`);

  const cfg = { agent: {}, command: {} };
  await hooks.config(cfg);

  const agents = Object.keys(cfg.agent);
  check(
    'the five roles are registered',
    ['orchestrator', 'architect', 'lead', 'analyst', 'builder'].every((role) => agents.includes(role)),
    agents.join(', '),
  );
  check(
    'the orchestrator has no model, so it inherits the chat model',
    !('model' in cfg.agent.orchestrator),
    `model=${cfg.agent.orchestrator.model}`,
  );
  check('exactly one primary agent', Object.values(cfg.agent).filter((a) => a.mode === 'primary').length === 1);
  check('commands are registered', Object.keys(cfg.command).length >= 8, `${Object.keys(cfg.command).length}`);
  check(
    'no execution-mode command survives',
    !Object.keys(cfg.command).some((name) => /-mode(-|$)/.test(name)),
    Object.keys(cfg.command).join(', '),
  );

  // A full lifecycle, with no bridge and no window anywhere in sight.
  const call = async (name, args = {}) => JSON.parse(await hooks.tool[name].execute(args, {}));
  await call('foundry_start', { objective: 'Headless lifecycle' });
  await call('foundry_plan', {
    author: 'analyst',
    scope: 'demo',
    summary: 'one task',
    proposals: [
      {
        title: 'Do the thing',
        objective: 'It is done',
        allowed_files: ['src/thing.ts'],
        acceptance_criteria: ['it works'],
        verification: 'npm test',
      },
    ],
  });
  await call('foundry_apply_plan', { plan: 'PLAN-001' });
  const next = await call('foundry_next');
  check('the scheduler offers work', next.started.length === 1, JSON.stringify(next.started));

  const id = next.started[0];

  // Headless means no OpenCode client, so there is no host to dispatch to.
  // Execution must still report that honestly instead of throwing or, worse,
  // quietly marking work done that nothing ever ran.
  const executed = await call('foundry_execute');
  check('execution dispatches the ready task', executed.started.length === 1, JSON.stringify(executed.started));
  check(
    'a context packet is produced and stays small',
    executed.results.every((r) => r.estimated_tokens > 0 && r.estimated_tokens < 2000),
    executed.results.map((r) => `${r.estimated_tokens} tokens`).join(', '),
  );
  check(
    'with no host, dispatch fails loudly rather than claiming success',
    executed.results.every((r) => r.ok === false && typeof r.error === 'string'),
    JSON.stringify(executed.results.map((r) => r.error)),
  );

  // The recovery path a human takes after a failed attempt.
  await call('foundry_task', { id, status: 'IN_PROGRESS' });

  const completed = await call('foundry_complete', {
    id,
    files_created: ['src/thing.ts'],
    commands_executed: ['npm test'],
    tests_executed: ['npm test'],
    test_result: 'pass',
    output_summary: 'ok',
  });
  check('completion with real evidence is accepted', completed.ok === true, JSON.stringify(completed.reasons ?? []));

  for (const gate of completed.pending_gates ?? []) {
    await call('foundry_review', { id, gate, decision: 'passed', reviewer: 'analyst' });
  }
  const board = await call('foundry_board');
  check('the board shows the task done', (board.totals.by_status.DONE ?? 0) === 1, JSON.stringify(board.totals.by_status));

  const ui = await call('foundry_ui');
  check('foundry_ui reports disabled rather than throwing', ui.status === 'disabled', JSON.stringify(ui));

  await hooks.dispose();
  check('dispose() completes cleanly', true);
} catch (error) {
  check('no unexpected error', false, error instanceof Error ? error.message : String(error));
} finally {
  rmSync(dir, { recursive: true, force: true });
  rmSync(configHome, { recursive: true, force: true });
}

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
