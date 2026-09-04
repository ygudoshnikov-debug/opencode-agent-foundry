/**
 * Desktop bridge wire protocol.
 *
 * The single source of truth for every payload crossing
 * plugin backend <-> Tauri shell <-> React WebView.
 *
 * Rules:
 * - Types only. No runtime imports, so the React app can import this file
 *   directly (via the `@foundry/protocol` alias) without pulling in Node.
 * - Every response is small by construction. The board and task list return
 *   summaries; full detail is a separate, explicit request.
 */

import type {
  FoundryEvent,
  GateName,
  GraphEdge,
  OpenQuestion,
  ProjectPhase,
  Role,
  Task,
  TaskStatus,
} from '../core/types.js';

export type { FoundryEvent, GraphEdge, OpenQuestion, ProjectPhase, Role, Task, TaskStatus, GateName };

/** Bumped whenever a breaking change lands in this file. */
export const PROTOCOL_VERSION = 3;

/** Handshake written to `.agent-foundry/desktop.json` (0600) by the bridge. */
export interface BridgeHandshake {
  protocol: number;
  /** Always loopback, e.g. `http://127.0.0.1:53124`. */
  url: string;
  /** Random per-process bearer token. Rotates on every bridge start. */
  token: string;
  /** Absolute path of the project the bridge is serving. */
  directory: string;
  pid: number;
  started_at: string;
}

/** Compact task shape for lists and board columns. */
export interface TaskSummary {
  id: string;
  title: string;
  status: TaskStatus;
  priority: number;
  owner: string;
  executor: string;
  module?: string;
  functionality?: string;
  attempts: number;
  depends_on: string[];
  blocked_by: string[];
  blast_radius: number;
  updated_at: string;
}

export interface BoardColumn {
  status: TaskStatus;
  task_ids: string[];
}

export interface Board {
  generated_at: string;
  columns: BoardColumn[];
  tasks: TaskSummary[];
  totals: { tasks: number; by_status: Record<string, number> };
}

export interface ProjectSummary {
  initialized: boolean;
  project_id?: string;
  objective?: string;
  phase?: ProjectPhase;
  status?: 'active' | 'paused' | 'completed';
  totals: { tasks: number; by_status: Record<string, number> };
  running: string[];
  blocked: Array<{ id: string; waiting_for: string[] }>;
  open_questions: OpenQuestion[];
  critical_path: string[];
  progress: { done: number; total: number; percent: number };
  cost_usd: number;
  tokens: number;
  plans: number;
  hint?: string;
}

export interface GraphView {
  edges: GraphEdge[];
  critical_path: string[];
  cycles: string[][];
  missing: Array<{ task: string; missing: string }>;
  order: string[];
}

export interface DoctorReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  task_count: number;
  file_overlaps: Array<{ a: string; b: string; files: string[] }>;
  tasks_without_acceptance_criteria: string[];
  stalled: string[];
}

/** One role's model binding, as shown and edited in the Settings view. */
export interface RoleModelBinding {
  role: Role;
  /** Empty string means "inherit the model selected in the chat". */
  model: string;
  configurable: boolean;
  description: string;
}

/** A model the user can actually pick, read from OpenCode's live catalogue. */
export interface ModelOption {
  /** "<providerID>/<modelID>" — the form stored in config. */
  id: string;
  providerID: string;
  modelID: string;
  /** Human label for the model. */
  name: string;
  /** Human label for the provider. */
  provider: string;
}

export interface ConfigView {
  source: string[];
  models: RoleModelBinding[];
  execution: { max_parallel: number; allow_file_overlap: boolean; max_retries: number };
  desktop: { enabled: boolean; autostart: boolean; port: number };
  limits: { max_cost_per_task_usd: number; max_cost_per_project_usd: number };
}

/**
 * Everything needed to configure a working session, in one payload.
 *
 * The chat onboarding and the desktop Settings screen are two views of this
 * same object, so they cannot drift: both read it, both write through the same
 * endpoints, and a change made in either is visible to the other on next read.
 */
/** A shipped preset, resolved against the models this account can reach. */
export interface ResolvedPresetView {
  id: string;
  label: string;
  summary: string;
  /** Role → the id that would be written. Empty means "inherit the chat model". */
  models: Record<Exclude<Role, 'orchestrator'>, string>;
  /** Roles with no reachable candidate; they would fall back to the chat model. */
  unavailable: string[];
  available: boolean;
}

export interface RuntimeView extends ConfigView {
  /**
   * False until someone has explicitly chosen a setup for this project. The
   * desktop uses it to decide whether to show the setup screen.
   */
  configured: boolean;
  /**
   * True when a chat session asked for the setup screen. `configured` alone is
   * the wrong test: a project that was configured last week still has to be
   * able to open the screen again on request, and would otherwise land on the
   * dashboard with the request silently dropped.
   */
  setup_requested: boolean;
  /** Models OpenCode can actually reach right now. Empty if unavailable. */
  catalogue: ModelOption[];
  /** The shipped vendor presets, already resolved against the catalogue. */
  presets: ResolvedPresetView[];
  /** Which preset the current bindings correspond to, if any. */
  active_preset: string | null;
  /**
   * How many builders may run at once. 0 means unlimited — the scheduler then
   * starts everything whose dependencies and file locks allow it.
   */
  builders: number;
}

/**
 * Body of `POST /api/setup`.
 *
 * Chat offers only two answers — keep, or open this window — so every choice
 * that actually names a model arrives here, from the screen that can show them.
 */
export interface ApplySetupRequest {
  /**
   * `keep` marks the current settings as chosen without changing them;
   * `inherit` clears every binding so all roles follow the chat model;
   * `preset` applies a shipped vendor preset; `custom` applies the supplied
   * per-role values.
   */
  choice: 'keep' | 'inherit' | 'preset' | 'custom';
  /** Required when choice is `preset`. */
  preset?: string;
  models?: Partial<Record<Exclude<Role, 'orchestrator'>, string>>;
  /** 0 = unlimited. */
  builders?: number;
}

/** Server-sent event frames on `GET /api/stream`. */
export type StreamFrame =
  | { type: 'hello'; protocol: number; directory: string }
  | { type: 'event'; event: FoundryEvent }
  | { type: 'invalidate'; scopes: Array<'board' | 'project' | 'graph' | 'config' | 'events'> }
  | { type: 'ping'; at: string };

export interface ApiError {
  error: string;
  detail?: string;
}

/**
 * Endpoint map. Kept here so the React service layer and the bridge router
 * cannot drift apart.
 */
export const API = {
  health: '/api/health',
  project: '/api/project',
  board: '/api/board',
  tasks: '/api/tasks',
  task: (id: string) => `/api/tasks/${encodeURIComponent(id)}`,
  graph: '/api/graph',
  events: '/api/events',
  doctor: '/api/doctor',
  config: '/api/config',
  configModel: '/api/config/model',
  runtime: '/api/runtime',
  setup: '/api/setup',
  answer: '/api/questions/answer',
  stream: '/api/stream',
} as const;

/** Body of `POST /api/config/model`. */
export interface SetModelRequest {
  role: Role;
  /** Empty string clears the binding (role falls back to the chat model). */
  model: string;
}

/** Body of `POST /api/questions/answer`. */
export interface AnswerQuestionRequest {
  id: string;
  answer: string;
}

/** Body of `PATCH /api/tasks/:id`. */
export interface UpdateTaskRequest {
  status?: TaskStatus;
  priority?: number;
  blocked_reason?: string;
}
