#!/usr/bin/env node
/**
 * Verifies that every relative Markdown link and image in the repository
 * resolves to a file, and that every in-page anchor (#heading) exists in the
 * target document.
 *
 * Documentation rots quietly: a renamed file or heading leaves a link that
 * still renders and only fails when a reader clicks it. This runs as part of
 * `npm run verify` so the break is caught in the same gate as a failing test.
 *
 * Run: node scripts/check-links.mjs [root]
 * Exit code 0 when every link resolves, 1 otherwise.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const skip = new Set(['node_modules', 'dist', 'target', '.git', 'gen']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

/** GitHub's heading-to-anchor rule, close enough for this repository. */
function slug(text) {
  return text
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

function anchorsOf(file) {
  const seen = new Map();
  const anchors = new Set();
  let inFence = false;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!heading) continue;
    let id = slug(heading[1]);
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    if (count) id = `${id}-${count}`;
    anchors.add(id);
  }
  return anchors;
}

const linkPattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const files = walk(root);
const problems = [];

for (const file of files) {
  let inFence = false;
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (/^\s*```/.test(line)) inFence = !inFence;
      if (inFence) return;
      for (const match of line.matchAll(linkPattern)) {
        const target = match[1];
        if (/^(https?:|mailto:|#$)/.test(target)) continue;
        const [pathPart, hash] = target.split('#');
        let resolved = file;
        if (pathPart) {
          resolved = resolve(dirname(file), decodeURIComponent(pathPart));
          if (!existsSync(resolved)) {
            problems.push(`${relative(root, file)}:${index + 1} missing target ${target}`);
            continue;
          }
          if (statSync(resolved).isDirectory()) {
            const readme = join(resolved, 'README.md');
            if (!existsSync(readme)) continue;
            resolved = readme;
          }
        }
        if (hash && resolved.endsWith('.md') && !anchorsOf(resolved).has(hash.toLowerCase())) {
          problems.push(`${relative(root, file)}:${index + 1} missing anchor #${hash} in ${relative(root, resolved)}`);
        }
      }
    });
}

console.log(`${files.length} Markdown files scanned`);
if (problems.length) {
  console.log(problems.join('\n'));
  process.exit(1);
}
console.log('every relative link and anchor resolves');
