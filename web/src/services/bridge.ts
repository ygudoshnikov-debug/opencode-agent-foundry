/**
 * Bridge configuration resolver.
 *
 * Tries, in order:
 * 1. the Tauri shell's `bridge_config` command (the real path),
 * 2. VITE_FOUNDRY_URL / VITE_FOUNDRY_TOKEN (running the UI from a dev server),
 * 3. `?url=&token=` on the query string (quick manual checks).
 *
 * Never throws synchronously, and resolves to null rather than rejecting, so a
 * missing bridge renders as a disconnected state instead of a blank screen.
 */

import { invoke } from '@tauri-apps/api/core';

export interface BridgeConfig {
  url: string;
  token: string;
}

let cachedConfig: BridgeConfig | null = null;
let resolvePromise: Promise<BridgeConfig | null> | null = null;

/**
 * Ask the Tauri shell for the bridge address and token.
 *
 * Two things here are load-bearing:
 *
 * - Detection uses `__TAURI_INTERNALS__`, which the WebView always defines.
 *   `__TAURI__` exists only when `withGlobalTauri` is enabled, so checking for
 *   it silently fails inside a correctly configured app.
 * - The import is STATIC. A dynamic import produces a separate chunk, and a
 *   chunk that fails to load inside the packaged app looks exactly like "no
 *   Tauri present" — the window then renders as disconnected with nothing in
 *   the logs to explain it. The module is ~2 kB and harmless in a browser,
 *   where `invoke` simply never gets called.
 */
async function tryTauri(): Promise<BridgeConfig | null> {
  try {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return null;
    const config = await invoke<{ url: string; token: string }>('bridge_config');
    if (!config?.url || !config?.token) return null;
    return { url: config.url, token: config.token };
  } catch {
    // No Tauri host, or the shell started without a bridge configuration.
    // The caller falls through to the other sources and, failing those,
    // renders the disconnected state.
    return null;
  }
}

/**
 * Attempt to get bridge config from Vite env vars.
 * Returns null if not set.
 */
function tryEnv(): BridgeConfig | null {
  const env = import.meta.env as Record<string, string | undefined>;
  const url = env.VITE_FOUNDRY_URL;
  const token = env.VITE_FOUNDRY_TOKEN;
  if (url && token) {
    return { url, token };
  }
  return null;
}

/**
 * Attempt to get bridge config from query string.
 * Returns null if not present.
 */
function tryQueryString(): BridgeConfig | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const url = params.get('url');
    const token = params.get('token');
    if (url && token) {
      return { url, token };
    }
  } catch (e) {
    // URLSearchParams not available
  }
  return null;
}

/**
 * Resolve bridge configuration from all sources.
 */
async function resolveBridgeConfig(): Promise<BridgeConfig | null> {
  if (cachedConfig !== null) {
    return cachedConfig;
  }

  // Try Tauri first
  const tauriConfig = await tryTauri();
  if (tauriConfig) {
    cachedConfig = tauriConfig;
    return cachedConfig;
  }

  // Try env vars
  const envConfig = tryEnv();
  if (envConfig) {
    cachedConfig = envConfig;
    return cachedConfig;
  }

  // Try query string
  const queryConfig = tryQueryString();
  if (queryConfig) {
    cachedConfig = queryConfig;
    return cachedConfig;
  }

  return null;
}

/**
 * Get the bridge configuration.
 * Resolves asynchronously and caches the result.
 */
export function getBridgeConfig(): Promise<BridgeConfig | null> {
  if (cachedConfig) {
    return Promise.resolve(cachedConfig);
  }

  if (!resolvePromise) {
    resolvePromise = resolveBridgeConfig();
  }

  return resolvePromise;
}

/**
 * Clear the cached bridge config (for testing).
 */
export function clearBridgeConfig(): void {
  cachedConfig = null;
  resolvePromise = null;
}

/**
 * Forgets the cached address and token, so the next request resolves them again.
 *
 * The plugin generates a fresh token every time it starts. A window that
 * outlives a plugin restart is brought back to the front by the single-instance
 * guard — but if it keeps using the token it resolved on first load, it can
 * never reconnect and sits on "Disconnected" forever, no matter how many times
 * the user reopens it. Reconnection attempts therefore start by re-resolving.
 */
export function refreshBridgeConfig(): Promise<BridgeConfig | null> {
  clearBridgeConfig();
  return getBridgeConfig();
}
