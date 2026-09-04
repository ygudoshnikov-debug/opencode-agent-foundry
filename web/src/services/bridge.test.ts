import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getBridgeConfig, clearBridgeConfig } from './bridge';

// The resolver reaches the shell through @tauri-apps/api/core, not through a
// `window.__TAURI__` global — that global only exists when `withGlobalTauri` is
// enabled, so relying on it silently breaks inside a real Tauri window.
const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

/** Marks the page as running inside a Tauri WebView. */
function insideTauri(): void {
  (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {};
}

function outsideTauri(): void {
  delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
}

describe('bridge config resolution', () => {
  beforeEach(() => {
    clearBridgeConfig();
    invoke.mockReset();
    outsideTauri();
    delete (import.meta.env as Record<string, unknown>)['VITE_FOUNDRY_URL'];
    delete (import.meta.env as Record<string, unknown>)['VITE_FOUNDRY_TOKEN'];
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    clearBridgeConfig();
    outsideTauri();
  });

  it('asks the Tauri shell first when running inside a window', async () => {
    insideTauri();
    invoke.mockResolvedValue({ url: 'http://127.0.0.1:5000', token: 'abc123', directory: '/p', protocol: 1 });

    const config = await getBridgeConfig();

    expect(invoke).toHaveBeenCalledWith('bridge_config');
    expect(config).toEqual({ url: 'http://127.0.0.1:5000', token: 'abc123' });
  });

  it('does not call the shell when not running inside a window', async () => {
    (import.meta.env as Record<string, unknown>)['VITE_FOUNDRY_URL'] = 'http://127.0.0.1:5001';
    (import.meta.env as Record<string, unknown>)['VITE_FOUNDRY_TOKEN'] = 'env-token';

    const config = await getBridgeConfig();

    expect(invoke).not.toHaveBeenCalled();
    expect(config).toEqual({ url: 'http://127.0.0.1:5001', token: 'env-token' });
  });

  it('falls back to the query string', async () => {
    window.history.replaceState({}, '', '/?url=http%3A%2F%2F127.0.0.1%3A5002&token=query-token');

    const config = await getBridgeConfig();

    expect(config).toEqual({ url: 'http://127.0.0.1:5002', token: 'query-token' });
  });

  it('falls through when the shell has no bridge configuration', async () => {
    insideTauri();
    invoke.mockRejectedValue(new Error('the desktop shell was started without a bridge configuration'));

    const config = await getBridgeConfig();

    expect(config).toBeNull();
  });

  it('falls through when the shell returns an incomplete configuration', async () => {
    insideTauri();
    invoke.mockResolvedValue({ url: '', token: '' });

    const config = await getBridgeConfig();

    expect(config).toBeNull();
  });

  it('returns null when no source has an answer', async () => {
    const config = await getBridgeConfig();
    expect(config).toBeNull();
  });

  it('resolves once and caches the result', async () => {
    insideTauri();
    invoke.mockResolvedValue({ url: 'http://127.0.0.1:5000', token: 'abc123', directory: '/p', protocol: 1 });

    const [first, second] = await Promise.all([getBridgeConfig(), getBridgeConfig()]);

    expect(first).toEqual(second);
    expect(invoke).toHaveBeenCalledOnce();
  });
});
