#!/usr/bin/env node
/**
 * desktop-binary.mjs
 * Exports (and when run directly, prints) the resolved path of the built desktop executable
 * for the current platform, checking release then debug.
 *
 * Importable from the plugin's launcher via plain relative import:
 *   import { getDesktopBinary } from '../scripts/desktop-binary.mjs';
 *
 * Dependency-free and side-effect-free on import.
 */

import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { platform } from 'os';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(import.meta.url).split(/[/\\]/).slice(0, -1).join('/').replace(/\//g, '\\');
const projectRoot = resolve(__dirname, '..');

/**
 * Resolves the path to the built desktop binary.
 * Returns null if no binary is found.
 * @returns {string | null}
 */
export function getDesktopBinary() {
  const platName = platform();
  const targetDir = join(projectRoot, 'src-tauri', 'target');

  if (platName === 'win32') {
    // Windows: check release first, then debug
    const releaseExe = join(targetDir, 'release', 'opencode-agent-foundry-desktop.exe');
    if (existsSync(releaseExe)) return releaseExe;

    const releaseAltExe = join(targetDir, 'release', 'Agent Foundry.exe');
    if (existsSync(releaseAltExe)) return releaseAltExe;

    const debugExe = join(targetDir, 'debug', 'opencode-agent-foundry-desktop.exe');
    if (existsSync(debugExe)) return debugExe;

    const debugAltExe = join(targetDir, 'debug', 'Agent Foundry.exe');
    if (existsSync(debugAltExe)) return debugAltExe;
  } else if (platName === 'darwin') {
    // macOS: the .app bundle inner binary
    const appPath = join(
      targetDir,
      'release',
      'bundle',
      'macos',
      'Agent Foundry.app',
      'Contents',
      'MacOS',
      'opencode-agent-foundry-desktop',
    );
    if (existsSync(appPath)) return appPath;

    // Check debug build
    const debugAppPath = join(
      targetDir,
      'debug',
      'bundle',
      'macos',
      'Agent Foundry.app',
      'Contents',
      'MacOS',
      'opencode-agent-foundry-desktop',
    );
    if (existsSync(debugAppPath)) return debugAppPath;
  } else if (platName === 'linux') {
    // Linux: plain binary
    const releaseBin = join(targetDir, 'release', 'opencode-agent-foundry-desktop');
    if (existsSync(releaseBin)) return releaseBin;

    const debugBin = join(targetDir, 'debug', 'opencode-agent-foundry-desktop');
    if (existsSync(debugBin)) return debugBin;
  }

  return null;
}

// If run directly, print the binary path
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const binary = getDesktopBinary();
  if (binary) {
    console.log(binary);
    process.exit(0);
  } else {
    console.error(`No desktop binary found for ${platform()}`);
    process.exit(1);
  }
}
