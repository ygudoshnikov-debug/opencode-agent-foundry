/**
 * Tracks whether the UI can actually reach the plugin.
 *
 * The status must reflect the STREAM, not the act of asking for one:
 * `subscribeStream` resolves as soon as it knows the bridge address, and the
 * connection attempt happens afterwards. Reporting "connected" at that point
 * meant the window showed a healthy indicator over a bridge that had already
 * shut down — which is exactly what happens after a one-shot `opencode run`
 * finishes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { subscribeStream } from '@/services/api';
import type { StreamFrame } from '@foundry/protocol';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface UseConnectionOptions {
  onFrame?: (frame: StreamFrame) => void;
  onStatusChange?: (status: ConnectionStatus) => void;
  autoStart?: boolean;
}

export function useConnection(options: UseConnectionOptions = {}) {
  const { onFrame, onStatusChange, autoStart = true } = options;
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const statusRef = useRef<ConnectionStatus>('disconnected');

  const unsubscribeRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  // Callbacks are kept in refs so a re-render never tears down a live stream.
  const onFrameRef = useRef(onFrame);
  const onStatusChangeRef = useRef(onStatusChange);
  onFrameRef.current = onFrame;
  onStatusChangeRef.current = onStatusChange;

  const apply = useCallback((next: ConnectionStatus) => {
    if (!mountedRef.current) return;
    statusRef.current = next;
    // Cheap diagnostic surface: a release build has no devtools, so the shell's
    // probe reads this to report what the page actually believes.
    (window as unknown as Record<string, unknown>)['__foundryStatus'] = next;
    setStatus((current) => (current === next ? current : next));
    onStatusChangeRef.current?.(next);
  }, []);

  const connect = useCallback(async () => {
    if (!mountedRef.current) return;
    apply('connecting');

    try {
      const unsubscribe = await subscribeStream(
        (frame) => {
          if (mountedRef.current) onFrameRef.current?.(frame);
        },
        {
          // Only now is the stream genuinely open.
          onOpen: () => apply('connected'),
          onError: () => apply('reconnecting'),
          onClose: () => apply('disconnected'),
        },
      );
      unsubscribeRef.current = unsubscribe;
    } catch {
      // No bridge address at all — nothing to reconnect to.
      apply('disconnected');
    }
  }, [apply]);

  const disconnect = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    apply('disconnected');
  }, [apply]);

  useEffect(() => {
    mountedRef.current = true;
    if (autoStart) void connect();
    return () => {
      mountedRef.current = false;
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, [autoStart, connect]);

  /**
   * Retry the moment the window is asked for again.
   *
   * Reopening the board after restarting the plugin does NOT create a window:
   * the single-instance guard focuses the existing one. That window is still
   * holding the previous token, which no longer works, so without an explicit
   * nudge the user stares at "Disconnected" until the exponential backoff
   * happens to come round — up to half a minute after they asked.
   *
   * The shell's `foundry://reopen` event is the reliable signal; focusing a
   * native window does not dependably raise a DOM focus event. Both are wired
   * because the DOM events also cover ordinary alt-tabbing back to a window
   * that dropped while it was in the background.
   */
  useEffect(() => {
    if (!autoStart) return;

    const reconnect = () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      void connect();
    };

    /**
     * The shell asked for the window: reconnect unconditionally.
     *
     * "Already connected" is not a reason to skip. The plugin may have restarted
     * with a new token while this window was still holding an open socket to a
     * bridge that is gone — the stream has no way to know until it goes quiet.
     * Reopening is the user explicitly asking for a working board, and one
     * redundant reconnect costs nothing.
     */
    const onShellReopen = () => reconnect();

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (statusRef.current === 'connected' || statusRef.current === 'connecting') return;
      reconnect();
    };

    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);

    // Statically imported on purpose. A dynamic import becomes its own chunk,
    // and a chunk that fails to load inside the packaged app is indistinguishable
    // from "the event never fired" — with nothing in any log to say so.
    let unlistenShell: (() => void) | undefined;
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      void listen('foundry://reopen', onShellReopen)
        .then((unlisten) => {
          unlistenShell = unlisten;
        })
        .catch(() => undefined);
    }

    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
      unlistenShell?.();
    };
  }, [autoStart, connect]);

  return {
    status,
    connect,
    disconnect,
    isConnected: status === 'connected',
  };
}
