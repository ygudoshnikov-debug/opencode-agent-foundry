#!/usr/bin/env node
/**
 * Runs the test suite.
 *
 * This exists because `node --test test/*.test.mjs` is not portable. The glob is
 * expanded by the shell on Linux and by Node itself only from Node 22, so the
 * same command passes on a developer's machine and fails on a Node 20 Windows
 * runner with "Could not find test/*.test.mjs" — which is exactly what CI caught
 * on the first run of this repository. Directory discovery (`node --test test`)
 * behaves differently across Node versions too.
 *
 * Reading the directory here and passing explicit paths removes the variable.
 */
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const testDir = join(root, 'test');

const files = readdirSync(testDir)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => join(testDir, name));

if (!files.length) {
  console.error(`No *.test.mjs files in ${testDir}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: root,
});

process.exit(result.status ?? 1);
