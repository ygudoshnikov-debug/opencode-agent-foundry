import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');

const bridgeModule = await import(new URL(`file://${distDir}/desktop/bridge.js`));
const engineModule = await import(new URL(`file://${distDir}/tools/engine.js`));
const schemaModule = await import(new URL(`file://${distDir}/config/schema.js`));

const { DesktopBridge } = bridgeModule;
const { createEngine } = engineModule;
const { defaultConfig } = schemaModule;

test('bridge: /api/health is reachable WITHOUT a token', async (t) => {
  const projectDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-bridge-'));
  try {
    const engine = createEngine(projectDir, { config: defaultConfig() });
    engine.start('Test');

    const bridge = new DesktopBridge({ projectDir });
    const info = await bridge.start();
    try {
      const response = await fetch(`${info.url}/api/health`);
      assert.strictEqual(response.status, 200);
      const body = await response.json();
      assert.strictEqual(body.ok, true);
    } finally {
      await bridge.stop();
    }
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('bridge: endpoints return 401 without a token', async (t) => {
  const projectDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-bridge-'));
  try {
    const engine = createEngine(projectDir, { config: defaultConfig() });
    engine.start('Test');

    const bridge = new DesktopBridge({ projectDir });
    const info = await bridge.start();
    try {
      const response = await fetch(`${info.url}/api/project`);
      assert.strictEqual(response.status, 401);
    } finally {
      await bridge.stop();
    }
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('bridge: endpoints return 401 with a WRONG token', async (t) => {
  const projectDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-bridge-'));
  try {
    const engine = createEngine(projectDir, { config: defaultConfig() });
    engine.start('Test');

    const bridge = new DesktopBridge({ projectDir });
    const info = await bridge.start();
    try {
      const response = await fetch(`${info.url}/api/project`, {
        headers: { Authorization: 'Bearer wrongtoken' },
      });
      assert.strictEqual(response.status, 401);
    } finally {
      await bridge.stop();
    }
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('bridge: with correct token, endpoints return 200', async (t) => {
  const projectDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-bridge-'));
  try {
    const engine = createEngine(projectDir, { config: defaultConfig() });
    engine.start('Test');

    const bridge = new DesktopBridge({ projectDir });
    const info = await bridge.start();
    try {
      const headers = { Authorization: `Bearer ${info.token}` };
      const endpoints = ['/api/project', '/api/board', '/api/config'];

      for (const endpoint of endpoints) {
        const response = await fetch(`${info.url}${endpoint}`, { headers });
        assert.strictEqual(response.status, 200, `${endpoint} should return 200`);
      }
    } finally {
      await bridge.stop();
    }
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('bridge: POST /api/config/model with "orchestrator" returns 400', async (t) => {
  const projectDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-bridge-'));
  try {
    const engine = createEngine(projectDir, { config: defaultConfig() });
    engine.start('Test');

    const bridge = new DesktopBridge({ projectDir });
    const info = await bridge.start();
    try {
      const headers = {
        Authorization: `Bearer ${info.token}`,
        'Content-Type': 'application/json',
      };

      const response = await fetch(`${info.url}/api/config/model`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ role: 'orchestrator', model: 'test/model' }),
      });
      assert.strictEqual(response.status, 400);
    } finally {
      await bridge.stop();
    }
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('bridge: handshake file is created and DELETED on stop()', async (t) => {
  const projectDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-bridge-'));
  try {
    const engine = createEngine(projectDir, { config: defaultConfig() });
    engine.start('Test');

    const bridge = new DesktopBridge({ projectDir });
    const info = await bridge.start();

    const handshakePath = join(projectDir, '.agent-foundry', 'desktop.json');
    assert(existsSync(handshakePath), 'handshake file should exist');

    const handshake = JSON.parse(readFileSync(handshakePath, 'utf8'));
    assert.strictEqual(handshake.url, info.url);
    assert.strictEqual(handshake.token, info.token);
    assert.strictEqual(handshake.directory, projectDir);

    await bridge.stop();
    assert(!existsSync(handshakePath), 'handshake file should be deleted after stop()');
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('bridge: after stop(), the port no longer accepts connections', async (t) => {
  const projectDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-bridge-'));
  try {
    const engine = createEngine(projectDir, { config: defaultConfig() });
    engine.start('Test');

    const bridge = new DesktopBridge({ projectDir });
    const info = await bridge.start();
    await bridge.stop();

    try {
      const response = await fetch(`${info.url}/api/health`, {
        signal: AbortSignal.timeout(2000),
      });
      assert.fail('should not be able to connect after stop()');
    } catch (error) {
      // Expected: connection refused or timeout
      assert(
        error.message.includes('ECONNREFUSED') ||
          error.name === 'AbortError' ||
          error.message.includes('fetch'),
      );
    }
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

/**
 * Regression tests for the CORS handling.
 *
 * A Tauri WebView is not same-origin with the bridge: it serves the page from
 * `http://tauri.localhost` (Windows) or `tauri://localhost` and fetches
 * `http://127.0.0.1:<port>`. Because every request carries an Authorization
 * header, the WebView sends a preflight OPTIONS first — which arrives WITHOUT
 * a token by definition. Answering that preflight with 401 makes the entire UI
 * fail to connect while the window still opens and looks fine, so these cases
 * are pinned.
 */
async function withBridge(fn) {
  const projectDir = mkdtempSync(join(process.env.TEMP || '/tmp', 'foundry-cors-'));
  try {
    createEngine(projectDir, { config: defaultConfig() }).start('CORS test');
    const bridge = new DesktopBridge({ projectDir });
    const info = await bridge.start();
    try {
      await fn(info);
    } finally {
      await bridge.stop();
    }
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
}

test('bridge: answers a CORS preflight without requiring a token', async () => {
  await withBridge(async (info) => {
    const response = await fetch(`${info.url}/api/board`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://tauri.localhost',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });
    assert.strictEqual(response.status, 204, 'preflight must not be rejected as unauthorized');
    assert.strictEqual(response.headers.get('access-control-allow-origin'), 'http://tauri.localhost');
    assert.match(response.headers.get('access-control-allow-headers') ?? '', /authorization/i);
  });
});

test('bridge: allows every origin the Tauri WebView can use', async () => {
  await withBridge(async (info) => {
    for (const origin of ['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost']) {
      const response = await fetch(`${info.url}/api/health`, { headers: { origin } });
      assert.strictEqual(response.status, 200, `${origin} should be allowed`);
      assert.strictEqual(response.headers.get('access-control-allow-origin'), origin);
    }
  });
});

test('bridge: allows loopback dev-server origins', async () => {
  await withBridge(async (info) => {
    const response = await fetch(`${info.url}/api/health`, { headers: { origin: 'http://localhost:5173' } });
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  });
});

test('bridge: refuses a foreign origin outright', async () => {
  await withBridge(async (info) => {
    const response = await fetch(`${info.url}/api/health`, { headers: { origin: 'https://evil.example.com' } });
    assert.strictEqual(response.status, 403);
    assert.strictEqual(response.headers.get('access-control-allow-origin'), null);
  });
});

test('bridge: never answers with a wildcard origin', async () => {
  await withBridge(async (info) => {
    const response = await fetch(`${info.url}/api/health`, { headers: { origin: 'http://tauri.localhost' } });
    assert.notStrictEqual(response.headers.get('access-control-allow-origin'), '*');
    assert.strictEqual(response.headers.get('vary'), 'Origin');
  });
});

test('bridge: a preflight from a foreign origin is still refused', async () => {
  await withBridge(async (info) => {
    const response = await fetch(`${info.url}/api/board`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example.com', 'access-control-request-method': 'GET' },
    });
    assert.strictEqual(response.status, 403);
  });
});

test('bridge: an allowed origin still needs a valid token for data', async () => {
  await withBridge(async (info) => {
    const unauthorized = await fetch(`${info.url}/api/board`, { headers: { origin: 'http://tauri.localhost' } });
    assert.strictEqual(unauthorized.status, 401, 'CORS must not become an authentication bypass');

    const authorized = await fetch(`${info.url}/api/board`, {
      headers: { origin: 'http://tauri.localhost', authorization: `Bearer ${info.token}` },
    });
    assert.strictEqual(authorized.status, 200);
  });
});
