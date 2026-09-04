# Agent Foundry Developer Scripts

Developer tooling and utilities for the Agent Foundry plugin project.

## Scripts

### desktop-doctor.mjs
Comprehensive environment check for desktop layer dependencies. Verifies Node.js, npm, Rust toolchain (cargo/rustc), platform-specific build tools (WebView2 on Windows, Xcode on macOS, WebKit2GTK on Linux), and checks for built artifacts. Prints colored, actionable error messages with exact fix commands. Exit code 0 if ready, 1 if checks fail.

Usage: `npm run desktop:doctor` or `node scripts/desktop-doctor.mjs`

### desktop-binary.mjs
Resolves the path to the built desktop executable for the current platform, checking release then debug builds. Used by the plugin launcher to find and start the Tauri app. Dependency-free and side-effect-free on import (can be imported by Node scripts). When run directly, prints the binary path or exits with code 1.

Usage: `node scripts/desktop-binary.mjs` or `import { getDesktopBinary } from './desktop-binary.mjs'`

### dev.mjs
Starts the complete development environment in one command: TypeScript watcher (tsc -w), web dev server (Vite on port 5173), and Tauri dev (creates native window with loopback bridge). Forwards SIGINT for clean shutdown and kills all child processes. Prints a banner showing what's running.

Usage: `npm run dev`

### smoke.mjs
Headless end-to-end smoke test for the plugin backend (does not require OpenCode or Tauri). Creates a temp project, imports dist/index.js, calls the plugin factory with a fake context, and validates: tool names, agent names, config hook, absence of vendor model names in agent identifiers, orchestrator has no model property, and no execution mode concepts. Cleans up temp directory on exit.

Usage: `npm run smoke`
