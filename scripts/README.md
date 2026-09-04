# Scripts

Utility scripts for development, verification, and testing. Each entry shows the script's purpose,
how to invoke it, what prerequisites are needed, and exit code semantics.

| Script | Purpose | How to run | Needs | Exit semantics |
| --- | --- | --- | --- | --- |
| **check-presets.mjs** | Verify all vendor presets against OpenCode's local model catalogue, check for unstable builds, validate cost ladder, report model ages | `npm run check:presets` | OpenCode catalogue (skips silently if absent) | 0: OK or catalogue missing; 1: preset error |
| **check-links.mjs** | Verify every relative Markdown link and heading anchor in the repository resolves, so a renamed file or heading fails the gate instead of a reader's click | `npm run check:links` | Nothing | 0: every link resolves; 1: a broken link or anchor |
| **demo.mjs** | Seed the sample project (a billing-service migration with ten tasks) and hold a bridge open so the console can be driven by hand; `--open` launches the native window, `--configured` seeds a configured project so the console opens on the dashboard | `npm run demo` or `node scripts/demo.mjs [--dir <path>] [--port <n>] [--open] [--configured]` | dist built; the desktop binary only for `--open` | 0 on Ctrl+C; 1 on a bridge or project error |
| **desktop-binary.mjs** | Resolve and print the path of the built desktop executable for the current platform, checking release then debug builds; importable as a module | `node scripts/desktop-binary.mjs` | Nothing to run; a desktop binary to find | 0 and the path when found; 1 when absent |
| **desktop-doctor.mjs** | Check and report the status of all dependencies for the desktop layer (Tauri, cargo, platform SDK, WebKit, MSVC tools) | `npm run desktop:doctor` | None | 0: all dependencies present; 1: missing dependencies |
| **dev.mjs** | Start the whole development loop: `tsc -w` for the plugin, the Vite dev server and `tauri dev` (native window with a loopback bridge) | `npm run dev` | Rust and cargo on PATH; Node 20 or later | 0 on Ctrl+C; 1 on a spawn error |
| **e2e-desktop.mjs** | End-to-end test of the desktop layer without OpenCode: seed a project, start the real bridge, launch the real native window, verify single-instance behavior, check handshake file lifecycle | `node scripts/e2e-desktop.mjs [--keep-open]` | dist built; desktop binary built | 0: all checks pass; 1: check failed |
| **headless-check.mjs** | Prove the plugin is fully usable with the desktop layer disabled (`desktop.enabled: false`) | `npm run check:headless` | dist built | 0: all checks pass; 1: check failed |
| **run-tests.mjs** | Run the backend test suite (node:test over `dist/`, 97 tests) with explicit test discovery to avoid shell-glob platform differences | `npm test` | dist built | 0: all tests pass; 1: test failure |
| **smoke.mjs** | Headless smoke test for architectural invariants (no vendor names in agent ids, orchestrator without `model`, no modes, tool budget, etc.) without OpenCode or Tauri | `npm run smoke` | dist built | 0: all invariants satisfied; 1: invariant violation |

## Running verification locally

```bash
npm run verify        # typecheck + test + smoke + preset audit + web tests + style audit
npm run check:styles  # prove every className resolves to CSS in the built bundle
npm run desktop:doctor # check desktop dependencies before building
```

See the main `package.json` for the complete script list and the `npm run` command names.
