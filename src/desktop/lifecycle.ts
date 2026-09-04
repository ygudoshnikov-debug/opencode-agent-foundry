import type { ChildProcess } from 'node:child_process';
import { DesktopBridge } from './bridge.js';
import { launch } from './launcher.js';
import type { FoundryConfig } from '../config/schema.js';
import type { Host } from '../runtime/host.js';
import type { SetupRequest } from '../runtime/setup.js';

/**
 * Desktop lifecycle.
 *
 * Owns the two halves of the feature — the bridge (a server) and the window (a
 * process) — and keeps them independent on purpose:
 *
 *   window closed, plugin alive  -> bridge keeps running; reopening is instant.
 *   plugin stops, window alive   -> bridge closes, the window shows
 *                                   "disconnected" and offers Retry.
 *
 * Everything degrades to a message. Nothing here may throw into the plugin's
 * startup path, because the core must work with no desktop layer at all.
 */

export interface DesktopStatus {
  status: 'opened' | 'reused' | 'disabled' | 'unavailable' | 'error';
  url?: string;
  detail?: string;
}

export class DesktopLifecycle {
  private bridge: DesktopBridge | null = null;
  private child: ChildProcess | null = null;
  private windowOpen = false;

  constructor(
    private readonly projectDir: string,
    private readonly config: FoundryConfig,
    /** Passed through to the bridge so the UI can read the model catalogue. */
    private readonly host: Host,
    /** Passed through so a chat asking for the setup screen reaches the window. */
    private readonly setupRequest?: SetupRequest,
  ) {}

  get bridgeUrl(): string | null {
    return this.bridge?.address?.url ?? null;
  }

  /** Starts the bridge without opening a window. Used by `desktop.autostart`. */
  async ensureBridge(): Promise<DesktopBridge | null> {
    if (!this.config.desktop.enabled) return null;
    if (this.bridge?.running) return this.bridge;
    const bridge = new DesktopBridge({
      projectDir: this.projectDir,
      port: this.config.desktop.port,
      host: this.host,
      ...(this.setupRequest ? { setupRequest: this.setupRequest } : {}),
    });
    await bridge.start();
    this.bridge = bridge;
    return bridge;
  }

  /**
   * Opens the window, or focuses the one already open. Reuse is enforced twice:
   * here (we do not spawn while a child is alive) and inside the Tauri shell
   * via the single-instance plugin, which focuses the existing window when a
   * second process starts.
   */
  async open(): Promise<DesktopStatus> {
    if (!this.config.desktop.enabled) {
      return { status: 'disabled', detail: 'Set desktop.enabled to true in agent-foundry.json.' };
    }

    try {
      const bridge = await this.ensureBridge();
      if (!bridge?.address) return { status: 'error', detail: 'the bridge failed to start' };
      const { url } = bridge.address;

      if (this.windowOpen && this.child && this.child.exitCode === null) {
        // Launching again is how we ask the running instance to come forward:
        // the single-instance plugin focuses it and the second process exits.
        launch({ directory: this.projectDir });
        return { status: 'reused', url, detail: 'brought the existing window to the front' };
      }

      const result = launch({ directory: this.projectDir });
      if (result.status === 'missing-binary' || result.status === 'failed') {
        return { status: 'unavailable', url, detail: result.detail };
      }

      this.child = result.child ?? null;
      this.windowOpen = true;
      this.child?.once('exit', () => {
        this.windowOpen = false;
        this.child = null;
      });
      return { status: 'opened', url, detail: 'native window opened' };
    } catch (error) {
      return { status: 'error', detail: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Tells open windows that state changed. Safe to call when nothing is up. */
  notify(scopes: Array<'board' | 'project' | 'graph' | 'config' | 'events'>): void {
    this.bridge?.notify(scopes);
  }

  /**
   * Shuts the bridge down. The window is intentionally left alone: killing a
   * visible window because a plugin reloaded is hostile, and the UI already
   * handles a dead bridge. The handshake file is removed either way, so a
   * stale token cannot be reused.
   */
  async dispose(): Promise<void> {
    const bridge = this.bridge;
    this.bridge = null;
    this.child = null;
    this.windowOpen = false;
    if (bridge) await bridge.stop();
  }
}
