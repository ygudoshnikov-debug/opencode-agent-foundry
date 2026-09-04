#!/usr/bin/env node
/**
 * dev.mjs
 * One command that starts the whole dev loop:
 * - Builds the plugin (tsc -w in background or single build)
 * - Starts the web dev server
 * - Runs tauri dev
 *
 * Forwards SIGINT and kills children so nothing is orphaned.
 * Prints a short banner explaining what is running and on which port.
 */

import { spawn } from 'child_process';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(import.meta.url).split(/[/\\]/).slice(0, -1).join('/').replace(/\//g, '\\');
const projectRoot = resolve(__dirname, '..');

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function colorize(text, color) {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

console.log(colorize('\n=== Agent Foundry Dev Server ===\n', 'cyan'));
console.log('Starting the complete dev environment...');
console.log('');
console.log('  • Plugin TypeScript watcher (tsc -w)');
console.log('  • Web dev server (Vite, http://localhost:5173)');
console.log('  • Tauri dev (window + loopback bridge)');
console.log('');
console.log('Press Ctrl+C to stop all services.');
console.log('');

const children = [];

function cleanup() {
  console.log(colorize('\nShutting down...', 'cyan'));
  children.forEach((child) => {
    try {
      process.kill(-child.pid); // Kill process group on Unix
    } catch (e) {
      try {
        child.kill();
      } catch (e2) {
        // Already dead
      }
    }
  });
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Start TypeScript watcher
console.log(colorize('[1/3] Starting TypeScript watcher...', 'green'));
const tsc = spawn('npx', ['tsc', '-w', '-p', 'tsconfig.json'], {
  cwd: projectRoot,
  stdio: 'inherit',
  detached: true,
});
children.push(tsc);

tsc.on('error', (err) => {
  console.error('TypeScript watcher error:', err);
});

// Give tsc a moment to start
await new Promise((resolve) => setTimeout(resolve, 1000));

// Start web dev server
console.log(colorize('[2/3] Starting web dev server (Vite)...', 'green'));
const web = spawn('npm', ['--prefix', 'web', 'run', 'dev'], {
  cwd: projectRoot,
  stdio: 'inherit',
  detached: true,
});
children.push(web);

web.on('error', (err) => {
  console.error('Web dev server error:', err);
});

// Give web dev server a moment to start
await new Promise((resolve) => setTimeout(resolve, 2000));

// Start Tauri dev
console.log(colorize('[3/3] Starting Tauri dev...', 'green'));
const tauri = spawn('npm', ['exec', 'tauri', 'dev', '--', '--config', 'src-tauri/tauri.conf.json'], {
  cwd: projectRoot,
  stdio: 'inherit',
  detached: true,
});
children.push(tauri);

tauri.on('error', (err) => {
  console.error('Tauri dev error:', err);
});

tauri.on('exit', (code) => {
  cleanup();
});
