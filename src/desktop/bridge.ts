import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createEngine, type Engine } from '../tools/engine.js';
import { FoundryStore } from '../core/store.js';
import { CONFIGURABLE_ROLES, type ConfigurableRole } from '../config/schema.js';
import { OFFLINE_HOST, type Host } from '../runtime/host.js';
import type { SetupRequest } from '../runtime/setup.js';
import {
  API,
  PROTOCOL_VERSION,
  type AnswerQuestionRequest,
  type ApplySetupRequest,
  type BridgeHandshake,
  type SetModelRequest,
  type StreamFrame,
  type UpdateTaskRequest,
} from './protocol.js';

/**
 * The desktop bridge.
 *
 * A loopback-only HTTP + SSE server that exposes the engine to the desktop
 * window. Security posture, in order of importance:
 *
 * - Binds 127.0.0.1 exclusively. It is never reachable off the machine.
 * - Every request must carry a bearer token generated fresh per process and
 *   compared in constant time. The token, not CORS, is the security boundary.
 * - The handshake file is written 0600 and deleted on stop, so the token does
 *   not outlive the server.
 * - Only the endpoints below exist. There is no generic filesystem, shell or
 *   proxy route, so a hostile page in the WebView cannot escalate through it.
 * - CORS is restricted to an explicit allowlist (the Tauri WebView origins and
 *   loopback dev servers) and never uses a wildcard.
 */

const HANDSHAKE_FILE = 'desktop.json';
const PING_INTERVAL_MS = 25_000;

/**
 * Origins allowed to talk to the bridge.
 *
 * A Tauri WebView is NOT same-origin with the bridge: it serves the app from
 * `tauri://localhost` (Linux/macOS) or `http://tauri.localhost` (Windows) and
 * fetches `http://127.0.0.1:<port>`. Because every request carries an
 * `Authorization` header, the WebView sends a CORS preflight first — which must
 * be answered without a token, or nothing works at all.
 *
 * Loopback origins are allowed so the UI can also be run from a dev server.
 * This is not a weakening: an unauthenticated caller still gets 401, and a
 * remote page cannot reach a loopback address in the first place.
 */
const TAURI_ORIGINS = new Set(['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost']);
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // Same-origin or a non-browser client.
  return TAURI_ORIGINS.has(origin) || LOOPBACK_ORIGIN.test(origin);
}

export interface BridgeOptions {
  projectDir: string;
  /** 0 asks the OS for a free port. */
  port?: number;
  /** Lets the UI read the live model catalogue. Offline when absent. */
  host?: Host;
  /** Shared with the chat tools so "open the setup screen" reaches this window. */
  setupRequest?: SetupRequest;
}

export interface BridgeInfo {
  url: string;
  token: string;
  port: number;
}

type Client = { id: number; res: ServerResponse };

export class DesktopBridge {
  private server: Server | null = null;
  private readonly clients = new Set<Client>();
  private clientSeq = 0;
  private ping: NodeJS.Timeout | null = null;
  private info: BridgeInfo | null = null;
  private lastEventSeq = 0;
  private readonly store: FoundryStore;
  private readonly token = randomBytes(32).toString('hex');

  constructor(private readonly options: BridgeOptions) {
    this.store = new FoundryStore(options.projectDir);
  }

  get running(): boolean {
    return this.server !== null;
  }

  get address(): BridgeInfo | null {
    return this.info;
  }

  private engine(): Engine {
    return createEngine(this.options.projectDir, {
      host: this.options.host ?? OFFLINE_HOST,
      ...(this.options.setupRequest ? { setupRequest: this.options.setupRequest } : {}),
    });
  }

  async start(): Promise<BridgeInfo> {
    if (this.info) return this.info;

    const server = createServer((req, res) => {
      void this.handle(req, res);
    });
    // Never hold OpenCode open because the bridge is idle.
    server.unref();

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.options.port ?? 0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('bridge failed to bind a TCP port');
    }

    this.server = server;
    this.info = { url: `http://127.0.0.1:${address.port}`, token: this.token, port: address.port };
    this.writeHandshake();
    this.ping = setInterval(() => this.broadcast({ type: 'ping', at: new Date().toISOString() }), PING_INTERVAL_MS);
    this.ping.unref();
    return this.info;
  }

  async stop(): Promise<void> {
    if (this.ping) {
      clearInterval(this.ping);
      this.ping = null;
    }
    for (const client of this.clients) {
      try {
        client.res.end();
      } catch {
        /* client already gone */
      }
    }
    this.clients.clear();
    this.removeHandshake();
    const server = this.server;
    this.server = null;
    this.info = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** Tells connected windows that state changed. Cheap and idempotent. */
  notify(scopes: Array<'board' | 'project' | 'graph' | 'config' | 'events'>): void {
    this.broadcast({ type: 'invalidate', scopes });
    this.flushEvents();
  }

  private writeHandshake(): void {
    if (!this.info) return;
    const handshake: BridgeHandshake = {
      protocol: PROTOCOL_VERSION,
      url: this.info.url,
      token: this.info.token,
      directory: this.options.projectDir,
      pid: process.pid,
      started_at: new Date().toISOString(),
    };
    this.store.ensureDir();
    const path = this.store.path(HANDSHAKE_FILE);
    writeFileSync(path, `${JSON.stringify(handshake, null, 2)}\n`, 'utf8');
    try {
      // Owner-only. Best effort: Windows ACLs do not map cleanly onto modes.
      chmodSync(path, 0o600);
    } catch {
      /* non-POSIX filesystem */
    }
  }

  private removeHandshake(): void {
    const path = this.store.path(HANDSHAKE_FILE);
    try {
      if (existsSync(path)) rmSync(path);
    } catch {
      /* already gone */
    }
  }

  private authorized(req: IncomingMessage): boolean {
    const header = req.headers['authorization'];
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
    const supplied = Buffer.from(header.slice(7));
    const expected = Buffer.from(this.token);
    if (supplied.length !== expected.length) return false;
    return timingSafeEqual(supplied, expected);
  }

  /** Applies the CORS allowlist. Returns false when the origin is refused. */
  private applyCors(req: IncomingMessage, res: ServerResponse): boolean {
    const origin = typeof req.headers['origin'] === 'string' ? req.headers['origin'] : undefined;
    if (!isAllowedOrigin(origin)) return false;
    if (origin) {
      // Echo the specific origin — never a wildcard, and never with credentials.
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'Origin');
    }
    res.setHeader('access-control-allow-headers', 'authorization, content-type');
    res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader('access-control-max-age', '600');
    return true;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;

    if (!this.applyCors(req, res)) {
      return this.json(res, 403, { error: 'origin not allowed' });
    }

    // A preflight carries no Authorization header by definition, so it must be
    // answered before the auth gate — otherwise every real request fails.
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health is unauthenticated so the launcher can wait for readiness without
    // holding the token. It returns nothing but liveness.
    if (path === API.health) {
      return this.json(res, 200, { ok: true, protocol: PROTOCOL_VERSION });
    }

    if (!this.authorized(req)) {
      return this.json(res, 401, { error: 'unauthorized' });
    }

    try {
      if (req.method === 'GET' && path === API.stream) return this.stream(req, res);
      if (req.method === 'GET' && path === API.project) return this.json(res, 200, this.engine().status());
      if (req.method === 'GET' && path === API.board) return this.json(res, 200, this.engine().board());
      if (req.method === 'GET' && path === API.graph) return this.json(res, 200, this.engine().graphView());
      if (req.method === 'GET' && path === API.doctor) return this.json(res, 200, this.engine().doctor());
      if (req.method === 'GET' && path === API.config) return this.json(res, 200, this.engine().configView());
      if (req.method === 'GET' && path === API.runtime) {
        return this.json(res, 200, await this.engine().runtime());
      }
      if (req.method === 'POST' && path === API.setup) {
        const body = await this.body<ApplySetupRequest>(req);
        const models: Partial<Record<ConfigurableRole, string>> = {};
        for (const [role, model] of Object.entries(body.models ?? {})) {
          if (CONFIGURABLE_ROLES.includes(role as ConfigurableRole)) {
            models[role as ConfigurableRole] = String(model ?? '');
          }
        }
        const engine = this.engine();
        await engine.setup({
          choice: body.choice ?? 'keep',
          ...(body.preset ? { preset: body.preset } : {}),
          ...(Object.keys(models).length ? { models } : {}),
          ...(typeof body.builders === 'number' ? { builders: body.builders } : {}),
        });
        this.notify(['config', 'project', 'events']);
        // The full runtime view, not the write outcome: the page replaces its
        // state with whatever this returns, and a summary would silently strip
        // the catalogue and the bindings it still needs to render.
        return this.json(res, 200, await engine.runtime());
      }
      if (req.method === 'GET' && path === API.events) {
        const limit = Number(url.searchParams.get('limit') ?? 50);
        return this.json(res, 200, this.engine().events(Number.isFinite(limit) ? limit : 50));
      }
      if (req.method === 'GET' && path === API.tasks) {
        return this.json(
          res,
          200,
          this.engine().taskList({
            ...(url.searchParams.get('status') ? { status: url.searchParams.get('status')! } : {}),
            ...(url.searchParams.get('module') ? { module: url.searchParams.get('module')! } : {}),
          }),
        );
      }
      if (path.startsWith('/api/tasks/')) {
        const id = decodeURIComponent(path.slice('/api/tasks/'.length));
        if (req.method === 'GET') return this.json(res, 200, this.engine().taskShow(id, true));
        if (req.method === 'PATCH') {
          const body = await this.body<UpdateTaskRequest>(req);
          const result = this.engine().taskUpdate(id, body);
          this.notify(['board', 'project', 'events']);
          return this.json(res, 200, result);
        }
      }
      if (req.method === 'POST' && path === API.configModel) {
        const body = await this.body<SetModelRequest>(req);
        if (!CONFIGURABLE_ROLES.includes(body.role as ConfigurableRole)) {
          return this.json(res, 400, {
            error: 'not configurable',
            detail: `${body.role} always uses the model selected in the chat`,
          });
        }
        const result = this.engine().setModel(body.role as ConfigurableRole, body.model ?? '');
        this.notify(['config', 'events']);
        return this.json(res, 200, result);
      }
      if (req.method === 'POST' && path === API.answer) {
        const body = await this.body<AnswerQuestionRequest>(req);
        const result = this.engine().answer([{ id: body.id, answer: body.answer }]);
        this.notify(['project', 'events']);
        return this.json(res, 200, result);
      }
      return this.json(res, 404, { error: 'not found', detail: path });
    } catch (error) {
      return this.json(res, 500, {
        error: 'internal error',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private stream(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const client: Client = { id: (this.clientSeq += 1), res };
    this.clients.add(client);
    this.send(client, { type: 'hello', protocol: PROTOCOL_VERSION, directory: this.options.projectDir });
    // Bring a reconnecting window up to date without it having to poll.
    this.send(client, { type: 'invalidate', scopes: ['board', 'project', 'graph', 'config', 'events'] });
    req.on('close', () => {
      this.clients.delete(client);
    });
  }

  /** Streams newly appended audit events to every open window. */
  private flushEvents(): void {
    if (!this.clients.size) return;
    const events = this.store.readEvents(50);
    for (const event of events) {
      if (event.seq <= this.lastEventSeq) continue;
      this.lastEventSeq = event.seq;
      this.broadcast({ type: 'event', event });
    }
  }

  private broadcast(frame: StreamFrame): void {
    for (const client of this.clients) this.send(client, frame);
  }

  private send(client: Client, frame: StreamFrame): void {
    try {
      client.res.write(`data: ${JSON.stringify(frame)}\n\n`);
    } catch {
      this.clients.delete(client);
    }
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(payload),
      // The bridge serves data to a native WebView, never to a browser page.
      'x-content-type-options': 'nosniff',
    });
    res.end(payload);
  }

  private async body<T>(req: IncomingMessage): Promise<T> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      // Nothing this API accepts is large; refuse anything that looks abusive.
      if (size > 256 * 1024) throw new Error('request body too large');
      chunks.push(chunk as Buffer);
    }
    if (!chunks.length) return {} as T;
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  }
}
