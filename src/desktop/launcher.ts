import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Locates and launches the Tauri desktop binary.
 *
 * Deliberately conservative: if the binary is missing we return a descriptive
 * status instead of throwing, because the plugin must keep working headless.
 * We never fall back to opening a browser — a browser tab is precisely the
 * experience this feature exists to avoid.
 */

const CRATE_NAME = 'opencode-agent-foundry-desktop';
const PRODUCT_NAME = 'Agent Foundry';

function packageRoot(): string {
  // dist/desktop/launcher.js -> dist/desktop -> dist -> <package root>
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

/** Candidate paths for the built executable, most-preferred first. */
export function binaryCandidates(root = packageRoot()): string[] {
  const target = join(root, 'src-tauri', 'target');
  const profiles = ['release', 'debug'];
  const names: string[] = [];
  if (process.platform === 'win32') {
    names.push(`${CRATE_NAME}.exe`, `${PRODUCT_NAME}.exe`);
  } else if (process.platform === 'darwin') {
    names.push(
      join(`${PRODUCT_NAME}.app`, 'Contents', 'MacOS', PRODUCT_NAME),
      join('bundle', 'macos', `${PRODUCT_NAME}.app`, 'Contents', 'MacOS', PRODUCT_NAME),
      CRATE_NAME,
    );
  } else {
    names.push(CRATE_NAME, PRODUCT_NAME.toLowerCase().replace(/\s+/g, '-'));
  }
  const out: string[] = [];
  for (const profile of profiles) for (const name of names) out.push(join(target, profile, name));
  return out;
}

export function findBinary(root = packageRoot()): string | null {
  for (const candidate of binaryCandidates(root)) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export interface LaunchOptions {
  /**
   * The project whose `.agent-foundry/desktop.json` holds the bridge address
   * and token. This is all the shell is told; see `launch` for why.
   */
  directory: string;
  root?: string;
}

export interface LaunchResult {
  status: 'launched' | 'missing-binary' | 'failed';
  binary?: string;
  detail?: string;
  child?: ChildProcess;
}

/**
 * Spawns the desktop window. Detached and with stdio ignored so the window
 * outlives a plugin reload — but we keep the handle so an explicit shutdown can
 * still close it, and we `unref` so OpenCode is never held open by it.
 *
 * The bearer token is deliberately NOT passed on the command line or in the
 * environment. On Unix, `/proc/<pid>/cmdline` and `/proc/<pid>/environ` are
 * readable by any process running as the same user, so argv and env would leak
 * the token to every other session on a shared-uid machine for as long as the
 * window stayed open. Instead we pass only the project directory and let the
 * shell read the owner-only handshake file the bridge already wrote.
 */
export function launch(options: LaunchOptions): LaunchResult {
  const binary = findBinary(options.root);
  if (!binary) {
    return {
      status: 'missing-binary',
      detail:
        'The desktop console has not been built yet. Run "npm run desktop:doctor" to check prerequisites, then "npm run desktop:build".',
    };
  }

  try {
    const child = spawn(binary, ['--directory', options.directory], {
      detached: true,
      stdio: 'ignore',
      // Inherit the environment, but make sure no earlier token is riding along.
      env: { ...process.env, FOUNDRY_BRIDGE_URL: '', FOUNDRY_BRIDGE_TOKEN: '', FOUNDRY_PROJECT_DIR: options.directory },
    });
    child.unref();
    return { status: 'launched', binary, child };
  } catch (error) {
    return {
      status: 'failed',
      binary,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
