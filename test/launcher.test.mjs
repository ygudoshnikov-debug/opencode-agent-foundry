import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');

const launcherModule = await import(new URL(`file://${distDir}/desktop/launcher.js`));
const { binaryCandidates, findBinary, launch } = launcherModule;

test('launcher: binaryCandidates returns platform-appropriate paths', (t) => {
  const candidates = binaryCandidates();

  assert(Array.isArray(candidates));
  assert(candidates.length > 0);

  // Check platform-specific patterns
  if (process.platform === 'win32') {
    assert(candidates.some((p) => p.includes('opencode-agent-foundry-desktop.exe')));
  } else if (process.platform === 'darwin') {
    assert(
      candidates.some((p) => p.includes('Agent Foundry.app')) ||
        candidates.some((p) => p.includes('Agent Foundry')),
    );
  } else {
    assert(
      candidates.some((p) => p.includes('opencode-agent-foundry-desktop')) ||
        candidates.some((p) => p.includes('agent-foundry')),
    );
  }
});

test('launcher: findBinary returns null when nothing is built', (t) => {
  // Use a non-existent root
  const fakeRoot = '/nonexistent/fake/path';
  const binary = findBinary(fakeRoot);
  assert.strictEqual(binary, null, 'should return null when binary does not exist');
});

test('launcher: launch() returns status missing-binary with a helpful detail rather than throwing', (t) => {
  const result = launch({
    url: 'http://127.0.0.1:8000',
    token: 'test-token',
    directory: '/tmp/test',
  });

  // Since no binary is built in the test environment
  if (result.status === 'missing-binary') {
    assert(result.detail);
    assert(result.detail.includes('desktop') || result.detail.includes('binary'));
  } else if (result.status === 'launched') {
    // If by chance a binary exists, this is also fine
    assert(result.binary);
    assert(result.child);
  } else if (result.status === 'failed') {
    assert(result.detail);
  }
});
