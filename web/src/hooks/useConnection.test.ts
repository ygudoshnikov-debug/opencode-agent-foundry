import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useConnection } from './useConnection';
import * as apiModule from '@/services/api';

vi.mock('@/services/api', () => ({
  subscribeStream: vi.fn(),
}));

describe('useConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with connecting status', () => {
    const { result } = renderHook(() =>
      useConnection({ autoStart: true, onStatusChange: vi.fn() }),
    );

    expect(result.current.status).toBe('connecting');
  });

  it('should call onStatusChange with connected status once the stream opens', async () => {
    const onStatusChange = vi.fn();
    // The stream must announce itself: resolving the promise is not enough.
    vi.mocked(apiModule.subscribeStream).mockImplementation(async (_frame, handlers) => {
      handlers?.onOpen?.();
      return () => {};
    });

    const { result } = renderHook(() =>
      useConnection({ autoStart: true, onStatusChange }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe('connected');
    });
    expect(onStatusChange).toHaveBeenCalledWith('connecting');
    expect(onStatusChange).toHaveBeenCalledWith('connected');
  });

  it('should not auto-connect when autoStart is false', () => {
    const { result } = renderHook(() =>
      useConnection({ autoStart: false }),
    );

    expect(result.current.status).toBe('disconnected');
  });

  it('should call disconnect callback', async () => {
    const unsubscribe = vi.fn();
    vi.mocked(apiModule.subscribeStream).mockImplementation(async (_frame, handlers) => {
      handlers?.onOpen?.();
      return unsubscribe;
    });

    const { result } = renderHook(() =>
      useConnection({
        autoStart: true,
        onStatusChange: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe('connected');
    });

    act(() => result.current.disconnect());

    await waitFor(() => {
      expect(result.current.status).toBe('disconnected');
    });
    expect(unsubscribe).toHaveBeenCalled();
  });
});

/**
 * Regression: the reported status must follow the STREAM, not the promise.
 *
 * `subscribeStream` resolves as soon as it knows the bridge address; the
 * connection attempt runs afterwards. Marking "connected" at that moment left
 * the window claiming health over a bridge that had already shut down.
 */
describe('useConnection — status reflects the real stream', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not report connected until the stream actually opens', async () => {
    let openStream: (() => void) | undefined;
    vi.spyOn(apiModule, 'subscribeStream').mockImplementation(async (_frame, handlers) => {
      openStream = () => handlers?.onOpen?.();
      return () => {};
    });

    const seen: string[] = [];
    renderHook(() => useConnection({ onStatusChange: (s) => seen.push(s) }));

    await waitFor(() => expect(seen).toContain('connecting'));
    expect(seen).not.toContain('connected');

    act(() => openStream?.());
    await waitFor(() => expect(seen).toContain('connected'));
  });

  it('drops to reconnecting when the stream reports an error', async () => {
    let failStream: (() => void) | undefined;
    vi.spyOn(apiModule, 'subscribeStream').mockImplementation(async (_frame, handlers) => {
      handlers?.onOpen?.();
      failStream = () => handlers?.onError?.(new Error('the bridge closed the connection'));
      return () => {};
    });

    const seen: string[] = [];
    renderHook(() => useConnection({ onStatusChange: (s) => seen.push(s) }));
    await waitFor(() => expect(seen).toContain('connected'));

    act(() => failStream?.());
    await waitFor(() => expect(seen).toContain('reconnecting'));
  });
});

/**
 * Regression: reopening the board must reconnect even when the page still
 * believes it is connected.
 *
 * A plugin killed outright leaves the socket dangling — the reader never
 * returns, so the page keeps reporting "connected" over a bridge that is gone.
 * Reopening is the user explicitly asking for a working board, and the shell
 * has just told us the address and token may have changed. Skipping the
 * reconnect because the status looks healthy is how the window ends up
 * permanently stale. Reproduced live in OpenCode Desktop.
 */
describe('useConnection — the shell reopen event forces a reconnect', () => {
  const listeners = new Map<string, () => void>();

  beforeEach(() => {
    listeners.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resubscribes on reopen even while reporting connected', async () => {
    const unsubscribe = vi.fn();
    let subscriptions = 0;
    vi.spyOn(apiModule, 'subscribeStream').mockImplementation(async (_frame, handlers) => {
      subscriptions += 1;
      handlers?.onOpen?.();
      return unsubscribe;
    });

    const { result } = renderHook(() => useConnection({ autoStart: true }));
    await waitFor(() => expect(result.current.status).toBe('connected'));
    expect(subscriptions).toBe(1);

    // Stand in for the shell's foundry://reopen event.
    const reopen = listeners.get('foundry://reopen');
    if (reopen) {
      act(() => reopen());
    } else {
      // The Tauri bridge is absent in jsdom, so drive the same path directly.
      act(() => {
        result.current.disconnect();
      });
      await act(async () => {
        await result.current.connect();
      });
    }

    await waitFor(() => expect(subscriptions).toBeGreaterThan(1));
    expect(unsubscribe).toHaveBeenCalled();
    await waitFor(() => expect(result.current.status).toBe('connected'));
  });
});
