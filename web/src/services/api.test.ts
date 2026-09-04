import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { ApiErrorImpl, parseSSEFrames, subscribeStream } from './api';
import { clearBridgeConfig } from './bridge';

describe('API Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ApiErrorImpl', () => {
    it('should create an API error with status and detail', () => {
      const error = new ApiErrorImpl(404, 'Not found');
      expect(error.status).toBe(404);
      expect(error.detail).toBe('Not found');
      expect(error.message).toBe('API Error: 404 - Not found');
    });

    it('should create an API error with just status', () => {
      const error = new ApiErrorImpl(500);
      expect(error.status).toBe(500);
      expect(error.detail).toBeUndefined();
      expect(error.message).toBe('API Error: 500');
    });
  });

  describe('parseSSEFrames', () => {
    it('should parse a single SSE frame', () => {
      const text = 'data: {"type":"hello","protocol":1,"directory":"."}\n\n';
      const frames = parseSSEFrames(text);
      expect(frames).toHaveLength(1);
      expect(frames[0].type).toBe('hello');
    });

    it('should parse multiple SSE frames', () => {
      const text =
        'data: {"type":"hello","protocol":1,"directory":"."}\n\ndata: {"type":"ping","at":"2024-01-01T00:00:00Z"}\n\n';
      const frames = parseSSEFrames(text);
      expect(frames).toHaveLength(2);
      expect(frames[0].type).toBe('hello');
      expect(frames[1].type).toBe('ping');
    });

    it('should handle incomplete frames', () => {
      const text = 'data: {"type":"hello","protocol":1,"directory":"."}';
      const frames = parseSSEFrames(text);
      expect(frames).toHaveLength(0);
    });

    it('should skip invalid JSON', () => {
      const text =
        'data: invalid json\n\ndata: {"type":"hello","protocol":1,"directory":"."}\n\n';
      const frames = parseSSEFrames(text);
      expect(frames).toHaveLength(1);
      expect(frames[0].type).toBe('hello');
    });

    it('should handle empty input', () => {
      const text = '';
      const frames = parseSSEFrames(text);
      expect(frames).toHaveLength(0);
    });
  });
});

/**
 * Regression: a CLEAN stream close is still a disconnect.
 *
 * When the plugin shuts down it closes the SSE stream without an error. The
 * reader simply reports `done` — no exception — so the original loop exited
 * normally and told nobody. The window kept a healthy "connected" indicator
 * over data that would never update again, which is exactly what happened
 * after a one-shot `opencode run` finished.
 */
describe('subscribeStream — disconnect handling', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearBridgeConfig();
    window.history.replaceState({}, '', '/?url=http%3A%2F%2F127.0.0.1%3A9999&token=t');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** A stream that emits one frame and then ends cleanly, like a shutdown. */
  function streamThatClosesCleanly(): Response {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"ping","at":"now"}\n\n'));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }

  it('reports a disconnect when the bridge closes the stream cleanly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamThatClosesCleanly()));

    const frames: unknown[] = [];
    const onError = vi.fn();
    const stop = await subscribeStream((frame) => frames.push(frame), { onError });

    // Let the reader drain and the close be observed.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(frames).toHaveLength(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]?.[0])).toMatch(/closed the connection/i);

    stop();
  });

  it('reports a disconnect when the request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const onError = vi.fn();
    const stop = await subscribeStream(() => {}, { onError });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(onError).toHaveBeenCalled();
    stop();
  });

  it('stops reconnecting once the caller unsubscribes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamThatClosesCleanly());
    vi.stubGlobal('fetch', fetchMock);

    const stop = await subscribeStream(() => {});
    await new Promise((resolve) => setTimeout(resolve, 50));
    stop();

    const callsAtStop = fetchMock.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 1600));
    expect(fetchMock.mock.calls.length).toBe(callsAtStop);
  });
});

/**
 * Regression: a window that outlives a plugin restart must pick up the new token.
 *
 * The plugin generates a fresh bearer token every time it starts. Reopening the
 * board is answered by the single-instance guard, which focuses the EXISTING
 * window — so if that window keeps using the token it resolved on first load,
 * it can never reconnect and shows "Disconnected" no matter how many times the
 * user reopens it. Observed live in OpenCode Desktop.
 */
describe('subscribeStream — credentials are re-resolved per attempt', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearBridgeConfig();
  });

  it('uses the token the shell reports now, not the one cached at load', async () => {
    clearBridgeConfig();
    window.history.replaceState({}, '', '/?url=http%3A%2F%2F127.0.0.1%3A1111&token=stale');

    const seenTokens: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
      seenTokens.push(String(init?.headers?.Authorization ?? ''));
      // First attempt fails as if the old bridge were gone; then the query
      // string changes, standing in for the shell reporting a rotated token.
      if (seenTokens.length === 1) {
        window.history.replaceState({}, '', '/?url=http%3A%2F%2F127.0.0.1%3A2222&token=fresh');
        throw new Error('ECONNREFUSED');
      }
      return new Response(new ReadableStream({ start: (c) => c.close() }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const stop = await subscribeStream(() => {});
    await new Promise((resolve) => setTimeout(resolve, 1800));
    stop();

    expect(seenTokens.length).toBeGreaterThanOrEqual(2);
    expect(seenTokens[0]).toContain('stale');
    expect(seenTokens[1]).toContain('fresh');
  });
});
