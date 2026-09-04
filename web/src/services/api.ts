/**
 * Typed API client.
 *
 * THE ONLY place that does fetch(). All requests go through here.
 * Injects the bearer token and maps non-2xx to a typed ApiError.
 */

import type {
  AnswerQuestionRequest,
  ApiError,
  ApplySetupRequest,
  Board,
  ConfigView,
  DoctorReport,
  GraphView,
  ProjectSummary,
  RuntimeView,
  SetModelRequest,
  StreamFrame,
  Task,
  TaskSummary,
  UpdateTaskRequest,
  API,
  FoundryEvent,
} from '@foundry/protocol';
import { getBridgeConfig, refreshBridgeConfig } from './bridge';

export class ApiErrorImpl extends Error {
  constructor(
    public status: number,
    public detail?: string,
  ) {
    super(`API Error: ${status}${detail ? ` - ${detail}` : ''}`);
    this.name = 'ApiError';
  }
}

interface RequestInit {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT';
  body?: unknown;
}

/**
 * Response types that match what the server actually returns.
 */
export interface TaskListResponse {
  total: number;
  tasks: TaskSummary[];
  truncated?: number;
}

export interface TaskUpdateResponse {
  id: string;
  status: string;
  also_changed?: string[];
}

export interface TaskDetailResponse extends TaskSummary {
  objective: string;
  allowed_files: string[];
  acceptance_criteria: string[];
  verification?: string;
  anchors: string[];
  gates: string[];
  error_summary?: string;
  blocked_reason?: string;
  upstream: string[];
  downstream: string[];
  history?: Task['history'];
  evidence?: Task['evidence'];
  escalation?: Task['escalation'];
}

/**
 * Internal fetch wrapper. Handles token injection and error mapping.
 */
async function apiFetch(
  url: string,
  init: RequestInit = {},
): Promise<unknown> {
  const config = await getBridgeConfig();
  if (!config) {
    throw new Error('Bridge not configured');
  }

  const fullUrl = `${config.url}${url}`;
  const fetchInit: globalThis.RequestInit = {
    method: init.method || 'GET',
    headers: {
      'Authorization': `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
  };

  if (init.body) {
    fetchInit.body = JSON.stringify(init.body);
  }

  const response = await fetch(fullUrl, fetchInit);

  if (!response.ok) {
    let detail: string | undefined;
    try {
      const error = (await response.json()) as ApiError;
      detail = error.detail || error.error;
    } catch {
      detail = response.statusText;
    }
    throw new ApiErrorImpl(response.status, detail);
  }

  return response.json();
}

/**
 * Parse SSE frames from a response body text.
 * Each frame is "data: {json}\n\n".
 */
export function parseSSEFrames(text: string): StreamFrame[] {
  const frames: StreamFrame[] = [];
  const lines = text.split('\n');
  let current = '';

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      current = line.slice(6);
    } else if (line === '' && current) {
      try {
        frames.push(JSON.parse(current));
      } catch (e) {
        console.error('Failed to parse SSE frame:', current, e);
      }
      current = '';
    }
  }

  return frames;
}

/**
 * Subscribe to server-sent events (SSE) using fetch + ReadableStream.
 * EventSource cannot send headers, so we use fetch with manual frame parsing.
 */
export interface StreamHandlers {
  /**
   * Fired when the stream is genuinely open.
   *
   * This exists because `subscribeStream` resolves as soon as it has a bridge
   * address — the connection attempt runs on after it returns. Callers that
   * treated "the promise resolved" as "we are connected" showed a healthy
   * indicator over a bridge that was never reachable.
   */
  onOpen?: () => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
}

export async function subscribeStream(
  onFrame: (frame: StreamFrame) => void,
  handlers: StreamHandlers = {},
): Promise<() => void> {
  const { onOpen, onError, onClose } = handlers;
  const config = await getBridgeConfig();
  if (!config) {
    const err = new Error('Bridge not configured');
    onError?.(err);
    throw err;
  }

  let bridgeUrl = config.url;
  let bridgeToken = config.token;
  let isClosed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** Consecutive failed attempts, for the backoff. Reset on a live stream. */
  let attempt = 0;

  /**
   * Watchdog for a stream that goes quiet.
   *
   * A cleanly closed stream reports `done`, but a plugin that is killed outright
   * just leaves the socket dangling — the reader never returns and the UI sits
   * on "connected" over a bridge that no longer exists. The server sends a ping
   * every 25s, so silence well past that means the connection is gone whether or
   * not anyone told us.
   */
  const SILENCE_LIMIT_MS = 70_000;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  function clearWatchdog(): void {
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = null;
    }
  }

  function armWatchdog(abort: () => void): void {
    clearWatchdog();
    if (isClosed) return;
    watchdog = setTimeout(() => {
      abort();
      scheduleReconnect(new Error('the bridge went silent'));
    }, SILENCE_LIMIT_MS);
  }

  /**
   * Schedules the next attempt with exponential backoff and jitter.
   *
   * Jitter matters because every open window reconnects at the same moment
   * when the plugin restarts, and a fixed delay would make them stampede.
   */
  function scheduleReconnect(reason: Error): void {
    if (isClosed) return;
    onError?.(reason);
    attempt += 1;
    const backoff = Math.min(1000 * 2 ** (attempt - 1), 30000);
    reconnectTimer = setTimeout(connect, backoff + Math.random() * 500);
  }

  async function connect() {
    if (isClosed) return;

    try {
      // Re-resolve before every attempt. The plugin rotates its token on each
      // start, so a window that outlived a restart must pick up the new one
      // instead of retrying forever with credentials that can never work.
      const current = await refreshBridgeConfig();
      if (current) {
        bridgeUrl = current.url;
        bridgeToken = current.token;
      }

      const controller = new AbortController();
      const response = await fetch(`${bridgeUrl}/api/stream`, {
        headers: { Authorization: `Bearer ${bridgeToken}` },
        signal: controller.signal,
      });

      if (!response.ok) throw new ApiErrorImpl(response.status);
      if (!response.body) throw new Error('the bridge returned no response body');

      // The stream is live: forget any earlier failures and say so.
      attempt = 0;
      onOpen?.();
      armWatchdog(() => controller.abort());

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let endedByServer = false;

      while (!isClosed) {
        const { done, value } = await reader.read();
        if (done) {
          endedByServer = true;
          break;
        }

        // Any traffic — a ping counts — proves the bridge is still there.
        armWatchdog(() => controller.abort());
        buffer += decoder.decode(value, { stream: true });

        // Frames are separated by a blank line; keep the trailing partial one.
        const parts = buffer.split('\n\n');
        buffer = parts[parts.length - 1]!;

        for (const part of parts.slice(0, -1)) {
          if (!part.startsWith('data: ')) continue;
          try {
            onFrame(JSON.parse(part.slice(6)) as StreamFrame);
          } catch (error) {
            console.error('Failed to parse SSE frame:', part, error);
          }
        }
      }

      // A CLEAN close is still a disconnect. The plugin shutting down ends the
      // stream without an error, and treating that as "nothing happened" left
      // the window showing a healthy indicator over permanently stale data.
      clearWatchdog();
      if (endedByServer && !isClosed) {
        scheduleReconnect(new Error('the bridge closed the connection'));
      }
    } catch (error) {
      clearWatchdog();
      scheduleReconnect(error instanceof Error ? error : new Error(String(error)));
    }
  }

  connect();

  return () => {
    isClosed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    clearWatchdog();
    onClose?.();
  };
}

/**
 * API method implementations.
 */

export const api = {
  async health(): Promise<{ ok: boolean; protocol: number }> {
    return apiFetch('/api/health') as Promise<{ ok: boolean; protocol: number }>;
  },

  async project(): Promise<ProjectSummary> {
    return apiFetch('/api/project') as Promise<ProjectSummary>;
  },

  async board(): Promise<Board> {
    return apiFetch('/api/board') as Promise<Board>;
  },

  async tasks(params?: { status?: string; module?: string }): Promise<TaskListResponse> {
    const q = params ? `?${new URLSearchParams(params as Record<string, string>).toString()}` : '';
    return apiFetch(`/api/tasks${q}`) as Promise<TaskListResponse>;
  },

  async task(id: string): Promise<TaskDetailResponse> {
    return apiFetch(`/api/tasks/${encodeURIComponent(id)}`) as Promise<TaskDetailResponse>;
  },

  async updateTask(id: string, update: UpdateTaskRequest): Promise<TaskUpdateResponse> {
    return apiFetch(`/api/tasks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: update,
    }) as Promise<TaskUpdateResponse>;
  },

  async graph(): Promise<GraphView> {
    return apiFetch('/api/graph') as Promise<GraphView>;
  },

  async events(limit?: number): Promise<FoundryEvent[]> {
    const q = limit ? `?limit=${limit}` : '';
    return apiFetch(`/api/events${q}`) as Promise<FoundryEvent[]>;
  },

  async doctor(): Promise<DoctorReport> {
    return apiFetch('/api/doctor') as Promise<DoctorReport>;
  },

  async config(): Promise<ConfigView> {
    return apiFetch('/api/config') as Promise<ConfigView>;
  },

  async setModel(request: SetModelRequest): Promise<ConfigView> {
    return apiFetch('/api/config/model', {
      method: 'POST',
      body: request,
    }) as Promise<ConfigView>;
  },

  async runtime(): Promise<RuntimeView> {
    return apiFetch('/api/runtime') as Promise<RuntimeView>;
  },

  async setup(request: ApplySetupRequest): Promise<RuntimeView> {
    return apiFetch('/api/setup', {
      method: 'POST',
      body: request,
    }) as Promise<RuntimeView>;
  },

  async answerQuestion(request: AnswerQuestionRequest): Promise<ConfigView> {
    return apiFetch('/api/questions/answer', {
      method: 'POST',
      body: request,
    }) as Promise<ConfigView>;
  },
};
