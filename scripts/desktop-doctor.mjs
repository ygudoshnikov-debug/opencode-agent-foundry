#!/usr/bin/env node
/**
 * desktop-doctor.mjs
 * Checks and reports the status of all dependencies needed for the desktop layer.
 * Exit code 0 if the desktop layer can run, 1 otherwise.
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { platform, arch } from 'os';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(import.meta.url).split(/[/\\]/).slice(0, -1).join('/').replace(/\//g, '\\');
const projectRoot = resolve(__dirname, '..');
const userProfile = process.env.USERPROFILE || process.env.HOME || '';

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function colorize(text, color) {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

function exec(cmd, silent = false) {
  try {
    return execSync(cmd, { stdio: silent ? 'pipe' : 'inherit', encoding: 'utf-8' }).trim();
  } catch (e) {
    return null;
  }
}

const report = {
  checks: [],
  errors: [],
  warnings: [],
};

function addCheck(name, ok, value, fixCmd) {
  const status = ok ? colorize('✓', 'green') : colorize('✗', 'red');
  const details = value ? ` (${value})` : '';
  console.log(`  ${status} ${name}${details}`);
  report.checks.push({ name, ok, value, fixCmd });
  if (!ok && fixCmd) {
    report.errors.push(`${name}: ${fixCmd}`);
  }
}

console.log(colorize('\n=== Agent Foundry Desktop Doctor ===\n', 'cyan'));

// Node & npm
console.log(colorize('Core Runtime:', 'bold'));
const nodeVersion = exec('node --version', true)?.slice(1);
addCheck('Node.js', !!nodeVersion, nodeVersion);

const npmVersion = exec('npm --version', true);
addCheck('npm', !!npmVersion, npmVersion);

// Cargo & Rustc
console.log(colorize('\nRust Toolchain:', 'bold'));
let cargoVersion = exec('cargo --version', true);
if (!cargoVersion && userProfile) {
  const cargoPath = join(userProfile, '.cargo', 'bin', 'cargo.exe');
  if (existsSync(cargoPath)) {
    cargoVersion = exec(`"${cargoPath}" --version`, true);
  }
}
const hasRust = !!cargoVersion;
addCheck(
  'Cargo',
  hasRust,
  cargoVersion ? cargoVersion.split('\n')[0] : undefined,
  hasRust ? undefined : 'rustup-init.exe from https://rustup.rs/ or: winget install Rustlang.Rust.GNU',
);

let rustcVersion = exec('rustc --version', true);
if (!rustcVersion && userProfile) {
  const rustcPath = join(userProfile, '.cargo', 'bin', 'rustc.exe');
  if (existsSync(rustcPath)) {
    rustcVersion = exec(`"${rustcPath}" --version`, true);
  }
}
addCheck(
  'Rustc',
  !!rustcVersion,
  rustcVersion ? rustcVersion.split('\n')[0] : undefined,
);

// Windows-specific
if (platform() === 'win32') {
  console.log(colorize('\nWindows Build Tools:', 'bold'));

  // WebView2
  let webView2Found = false;
  const programFilesx86 = process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)';
  const webViewPath = join(programFilesx86, 'Microsoft/EdgeWebView/Application');
  webView2Found = existsSync(webViewPath);

  if (!webView2Found) {
    const regCheck = exec(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\EdgeWebView" /v Version',
      true,
    );
    webView2Found = !!regCheck;
  }

  addCheck(
    'WebView2 Runtime',
    webView2Found,
    undefined,
    webView2Found
      ? undefined
      : 'Download from: https://developer.microsoft.com/en-us/microsoft-edge/webview2/ or: winget install Microsoft.EdgeWebView2Runtime',
  );

  // MSVC (via vswhere)
  let msvcFound = false;
  let msvcVersion = null;
  const vsWherePath = join(
    programFilesx86,
    'Microsoft Visual Studio/Installer/vswhere.exe',
  );
  if (existsSync(vsWherePath)) {
    const vsInfo = exec(`"${vsWherePath}" -latest -products Microsoft.VisualStudio.Product.Community`, true);
    msvcFound = !!vsInfo;
    if (msvcFound) {
      const versionMatch = vsInfo.match(/productLineVersion: (\d+)/);
      msvcVersion = versionMatch ? `VS ${versionMatch[1]}` : 'Visual Studio';
    }
  } else {
    const vsInstallPath = exec(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\SxS\\VS7" /v 17.0',
      true,
    );
    msvcFound = !!vsInstallPath;
    if (msvcFound) msvcVersion = 'Visual Studio 2022';
  }

  addCheck(
    'MSVC Build Tools',
    msvcFound,
    msvcVersion || undefined,
    msvcFound
      ? undefined
      : 'Download Visual Studio Build Tools from: https://visualstudio.microsoft.com/downloads/ (select Desktop development with C++)',
  );
}

if (platform() === 'darwin') {
  console.log(colorize('\nmacOS Tools:', 'bold'));
  const xcodeCheck = exec('xcode-select -p', true);
  addCheck(
    'Xcode Command Line Tools',
    !!xcodeCheck,
    xcodeCheck || undefined,
    xcodeCheck ? undefined : 'xcode-select --install',
  );
}

if (platform() === 'linux') {
  console.log(colorize('\nLinux Libraries:', 'bold'));
  const pkgConfigCheck = exec('pkg-config --modversion gtk4', true);
  addCheck(
    'GTK4 (WebKit2GTK)',
    !!pkgConfigCheck,
    pkgConfigCheck || 'not found',
    pkgConfigCheck ? undefined : 'apt-get install libwebkit2gtk-4.1-dev (Ubuntu/Debian)',
  );
}

// Project dependencies
console.log(colorize('\nProject Build Output:', 'bold'));

const webNodeModules = join(projectRoot, 'web', 'node_modules');
const hasWebDeps = existsSync(webNodeModules);
addCheck(
  'web/node_modules',
  hasWebDeps,
  undefined,
  hasWebDeps ? undefined : 'cd web && npm install',
);

const tauriTarget = join(projectRoot, 'src-tauri', 'target');
const hasTauriTarget = existsSync(tauriTarget);
addCheck(
  'src-tauri/target',
  hasTauriTarget,
  undefined,
  hasTauriTarget ? undefined : 'cd src-tauri && cargo build --release',
);

// Check for binary
console.log(colorize('\nDesktop Binary:', 'bold'));
let binaryPath = null;
const platName = platform();

if (platName === 'win32') {
  const releaseExe = join(projectRoot, 'src-tauri', 'target', 'release', 'opencode-agent-foundry-desktop.exe');
  const debugExe = join(projectRoot, 'src-tauri', 'target', 'debug', 'opencode-agent-foundry-desktop.exe');
  const releaseAltExe = join(projectRoot, 'src-tauri', 'target', 'release', 'Agent Foundry.exe');

  if (existsSync(releaseExe)) binaryPath = releaseExe;
  else if (existsSync(releaseAltExe)) binaryPath = releaseAltExe;
  else if (existsSync(debugExe)) binaryPath = debugExe;
} else if (platName === 'darwin') {
  const appPath = join(
    projectRoot,
    'src-tauri',
    'target',
    'release',
    'bundle',
    'macos',
    'Agent Foundry.app',
    'Contents',
    'MacOS',
    'opencode-agent-foundry-desktop',
  );
  if (existsSync(appPath)) binaryPath = appPath;
} else if (platName === 'linux') {
  const binPath = join(projectRoot, 'src-tauri', 'target', 'release', 'opencode-agent-foundry-desktop');
  if (existsSync(binPath)) binaryPath = binPath;
}

const hasBinary = !!binaryPath;
addCheck(
  'Built binary',
  hasBinary,
  binaryPath ? `${binaryPath}` : undefined,
  hasBinary ? undefined : 'npm run build:desktop or: cd src-tauri && cargo build --release',
);

// Summary
console.log(colorize('\n=== Summary ===\n', 'cyan'));

const allOk = report.checks.every((c) => c.ok);
if (allOk) {
  console.log(colorize('✓ All checks passed. Desktop layer is ready.', 'green'));
} else {
  const failed = report.checks.filter((c) => !c.ok);
  console.log(
    colorize(
      `✗ ${failed.length} check(s) failed:`,
      'red',
    ),
  );
  console.log('');
  report.errors.forEach((err) => {
    console.log(`  • ${err}`);
  });
}

console.log('');
process.exit(allOk ? 0 : 1);
