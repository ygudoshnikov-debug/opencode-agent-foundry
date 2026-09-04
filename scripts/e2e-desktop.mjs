#!/usr/bin/env node
/**
 * End-to-end desktop check.
 *
 * Proves the whole chain without OpenCode: seed a project, start the real
 * bridge, launch the real native window, and verify that
 *
 *   1. the bridge answers authenticated requests over loopback,
 *   2. the handshake file is written and then removed,
 *   3. the native binary starts, stays alive, and opens a window,
 *   4. a second launch does NOT create a second process (single instance),
 *   5. shutting the bridge down leaves no orphan.
 *
 * Run: node scripts/e2e-desktop.mjs [--keep-open]
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const url = (p) => `file:///${join(root, p).split('\\').join('/')}`;
const keepOpen = process.argv.includes('--keep-open');

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

/**
 * Counts running processes whose image name matches.
 *
 * `tasklist` truncates the image name column to 25 characters, so matching on
 * the full executable name silently returns 0 for any longer name. Compare
 * against the truncated form instead.
 */
function countProcesses(exeName) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${exeName}`, '/NH'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      const needle = exeName.slice(0, 25).toLowerCase();
      return out
        .split('\n')
        .filter((line) => line.toLowerCase().includes(needle))
        .length;
    }
    const out = execFileSync('pgrep', ['-f', exeName], { encoding: 'utf8' });
    return out.split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

/**
 * Counts ESTABLISHED connections to the bridge port from anything other than
 * this process. In practice that is the WebView process, which keeps the SSE
 * stream open — the only external proof that the UI actually loaded and
 * authenticated, rather than merely opening a window.
 */
function countBridgeConnections(port) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('netstat', ['-n', '-p', 'TCP'], { encoding: 'utf8', windowsHide: true });
      return out
        .split('\n')
        .filter((line) => line.includes(`:${port}`) && line.includes('ESTABLISHED'))
        .length;
    }
    const out = execFileSync('sh', ['-c', `netstat -an 2>/dev/null | grep ':${port} ' | grep -c ESTABLISHED`], {
      encoding: 'utf8',
    });
    return Number(out.trim()) || 0;
  } catch {
    return 0;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('\n=== Agent Foundry desktop end-to-end ===\n');

  const { createEngine } = await import(url('dist/tools/engine.js'));
  const { DesktopBridge } = await import(url('dist/desktop/bridge.js'));
  const { findBinary, launch } = await import(url('dist/desktop/launcher.js'));

  const dir = mkdtempSync(join(tmpdir(), 'foundry-e2e-'));
  let bridge;
  let launched = false;
  let exeName = '';

  try {
    // ---- seed a project so the UI has something real to render -------------
    const engine = createEngine(dir);
    engine.start('End-to-end desktop verification');
    engine.planSubmit({
      author: 'architect',
      scope: 'demo',
      summary: 'two tasks, the second depending on the first',
      proposals: [
        {
          ref: 'a',
          title: 'Create the module',
          objective: 'Scaffold it',
          allowed_files: ['src/a.ts'],
          acceptance_criteria: ['file exists'],
          verification: 'npm test',
          priority: 7,
        },
        {
          title: 'Wire it up',
          objective: 'Use the module',
          allowed_files: ['src/b.ts'],
          acceptance_criteria: ['imports a.ts'],
          depends_on: ['a'],
          priority: 5,
        },
      ],
    });
    engine.planApply('PLAN-001');
    const board = engine.board();
    check('project seeded', board.totals.tasks === 2, `${board.totals.tasks} tasks`);

    // ---- bridge ------------------------------------------------------------
    bridge = new DesktopBridge({ projectDir: dir });
    const info = await bridge.start();
    check('bridge bound to loopback', info.url.startsWith('http://127.0.0.1:'), info.url);

    const handshakePath = join(dir, '.agent-foundry', 'desktop.json');
    check('handshake written', existsSync(handshakePath));
    const handshake = JSON.parse(readFileSync(handshakePath, 'utf8'));
    check('handshake carries url + token', handshake.url === info.url && handshake.token === info.token);

    const health = await fetch(`${info.url}/api/health`);
    check('health needs no token', health.status === 200, `status ${health.status}`);

    const noAuth = await fetch(`${info.url}/api/board`);
    check('board rejects a missing token', noAuth.status === 401, `status ${noAuth.status}`);

    const badAuth = await fetch(`${info.url}/api/board`, { headers: { authorization: 'Bearer wrong' } });
    check('board rejects a wrong token', badAuth.status === 401, `status ${badAuth.status}`);

    const authed = await fetch(`${info.url}/api/board`, {
      headers: { authorization: `Bearer ${info.token}` },
    });
    const body = await authed.json();
    check('board returns data with the token', authed.status === 200 && body.totals.tasks === 2);

    const project = await fetch(`${info.url}/api/project`, {
      headers: { authorization: `Bearer ${info.token}` },
    }).then((r) => r.json());
    check('project summary reports progress', typeof project.progress?.percent === 'number');

    const cfg = await fetch(`${info.url}/api/config`, {
      headers: { authorization: `Bearer ${info.token}` },
    }).then((r) => r.json());
    const orchestrator = cfg.models.find((m) => m.role === 'orchestrator');
    check('orchestrator is not model-configurable', orchestrator && orchestrator.configurable === false);

    const rejected = await fetch(`${info.url}/api/config/model`, {
      method: 'POST',
      headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'orchestrator', model: 'anything' }),
    });
    check('binding a model to the orchestrator is refused', rejected.status === 400, `status ${rejected.status}`);

    // ---- native window -----------------------------------------------------
    const binary = findBinary(root);
    check('native binary found', Boolean(binary), binary ?? 'not built');

    if (binary) {
      exeName = binary.split(/[/\\]/).pop();

      // Close any window left over from a previous run. The single-instance
      // guard means a stale window silently absorbs our launch and focuses
      // itself against a bridge that no longer exists, which would make the
      // checks below fail for a reason that has nothing to do with the code.
      if (countProcesses(exeName) > 0) {
        console.log('  ..   closing a desktop window left over from an earlier run');
        try {
          if (process.platform === 'win32') execFileSync('taskkill', ['/IM', exeName, '/F'], { windowsHide: true });
          else execFileSync('pkill', ['-f', exeName]);
        } catch {
          /* already gone */
        }
        await sleep(1500);
      }

      const before = countProcesses(exeName);

      const result = launch({ directory: dir, root });
      check('window launched', result.status === 'launched', result.detail ?? '');
      launched = result.status === 'launched';

      // Give the shell time to create its window and register single-instance.
      await sleep(4000);
      const after = countProcesses(exeName);
      check('desktop process is running', after > before, `${before} -> ${after}`);

      // The decisive check: the WebView must actually reach the bridge.
      // "The process is running" is not enough — a window that renders a blank
      // page or fails to resolve its token looks identical from the outside.
      await sleep(3000);
      check(
        'the WebView holds a live connection to the bridge',
        countBridgeConnections(info.port) > 0,
        'no established connection from the window to the bridge port',
      );

      // A second launch must be absorbed by the single-instance guard.
      launch({ directory: dir, root });
      await sleep(3000);
      const afterSecond = countProcesses(exeName);
      check(
        'second launch does not create a second window',
        afterSecond === after,
        `${after} -> ${afterSecond}`,
      );
    }

    // ---- shutdown ----------------------------------------------------------
    await bridge.stop();
    bridge = null;
    check('handshake removed on stop', !existsSync(handshakePath));

    let refused = false;
    try {
      await fetch(`${info.url}/api/health`, { signal: AbortSignal.timeout(1500) });
    } catch {
      refused = true;
    }
    check('port closed after stop', refused);

    if (launched && !keepOpen && exeName) {
      // The window deliberately outlives the bridge; close it so the check
      // leaves nothing behind.
      try {
        if (process.platform === 'win32') execFileSync('taskkill', ['/IM', exeName, '/F'], { windowsHide: true });
        else execFileSync('pkill', ['-f', exeName]);
      } catch {
        /* already gone */
      }
      await sleep(500);
      check('no orphan process left', countProcesses(exeName) === 0);
    } else if (keepOpen) {
      console.log('\n  (--keep-open: the window was left running for inspection)');
    }
  } finally {
    if (bridge) await bridge.stop().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
