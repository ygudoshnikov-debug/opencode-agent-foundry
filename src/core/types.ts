/**
 * opencode-agent-foundry — core domain types.
 *
 * Design rules (see README "Architecture"):
 * - Task is the fundamental persistent unit, never chat messages.
 * - Agents are ROLES (organisational function). LLM models are configuration.
 *   No type in this file may reference a model, vendor or version.
 * - The Kanban is a projection of task status; the Work Graph (tasks + edges)
 *   is the execution structure. There is exactly one execution flow.
 */

/** Organisational roles. Never a model, vendor or version name. */
export type Role = 'orchestrator' | 'architect' | 'lead' | 'analyst' | 'builder';

export const ROLES: readonly Role[] = ['orchestrator', 'architect', 'lead', 'analyst', 'builder'];

/**
 * Roles that can be assigned an LLM model in config. The orchestrator is absent
 * on purpose: it always runs on the model selected in the chat.
 */
export type ConfigurableRole = Exclude<Role, 'orchestrator'>;

export const CONFIGURABLE_ROLES: readonly ConfigurableRole[] = ['architect', 'lead', 'analyst', 'builder'];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** Kanban columns. One list, one flow. Ordered left-to-right as displayed. */
export type TaskStatus =
  | 'BACKLOG'
  | 'PLANNED'
  | 'READY'
  | 'IN_PROGRESS'
  | 'REVIEW'
  | 'BLOCKED'
  | 'FAILED'
  | 'DONE'
  | 'CANCELLED';

export const KANBAN_COLUMNS: readonly TaskStatus[] = [
  'BACKLOG',
  'PLANNED',
  'READY',
  'IN_PROGRESS',
  'REVIEW',
  'BLOCKED',
  'FAILED',
  'DONE',
  'CANCELLED',
];

/** Statuses that end a task's life. */
export const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['DONE', 'CANCELLED']);

/** Statuses that satisfy a dependency for downstream unblocking. */
export const SATISFIED_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['DONE']);

/** Statuses that occupy an executor slot. */
export const RUNNING_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['IN_PROGRESS']);

/** Statuses the scheduler may pick up. */
export const SCHEDULABLE_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['PLANNED', 'READY']);

/**
 * Legacy status names (v1 of the on-disk format) mapped onto the current
 * 9-column board. Keeps existing `.agent-foundry/` directories readable.
 */
const LEGACY_STATUS: Readonly<Record<string, TaskStatus>> = {
  WAITING: 'BLOCKED',
  TESTING: 'REVIEW',
  CORRECTED: 'READY',
  FIXING: 'IN_PROGRESS',
  VERIFIED: 'DONE',
};

export function normalizeStatus(value: string | undefined): TaskStatus {
  if (!value) return 'BACKLOG';
  if ((KANBAN_COLUMNS as readonly string[]).includes(value)) return value as TaskStatus;
  return LEGACY_STATUS[value] ?? 'BACKLOG';
}

export type EdgeKind = 'depends_on' | 'blocks' | 'related_to' | 'parent_of' | 'child_of';

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}

export interface TaskEvidence {
  files_created?: string[];
  files_modified?: string[];
  files_deleted?: string[];
  commands_executed?: string[];
  tests_executed?: string[];
  test_result?: 'pass' | 'fail' | 'unknown';
  output_summary?: string;
}

export interface TaskAttempt {
  n: number;
  at: string;
  actor: Role | string;
  result: 'success' | 'failure' | 'blocked';
  error_summary?: string;
  evidence?: TaskEvidence;
}

export type GateName = 'execution' | 'test' | 'review' | 'architecture' | 'acceptance';

export const GATE_ORDER: readonly GateName[] = ['execution', 'test', 'review', 'architecture', 'acceptance'];

export interface ReviewGate {
  gate: GateName;
  status: 'pending' | 'passed' | 'rejected' | 'skipped';
  reviewer?: Role | string;
  at?: string;
  note?: string;
}

export interface Task {
  id: string;
  title: string;
  objective: string;
  module?: string;
  functionality?: string;
  status: TaskStatus;
  /** 1 (lowest) .. 9 (highest). Ties break on graph weight then id. */
  priority: number;
  owner: Role | string;
  executor: Role | string;
  depends_on: string[];
  blocks: string[];
  related_to: string[];
  parent_task?: string;
  child_tasks: string[];
  allowed_files: string[];
  acceptance_criteria: string[];
  verification?: string;
  /** Immutable reference points (human decisions, frozen contracts). */
  anchors: string[];
  attempts: number;
  /** Capped: see HISTORY_LIMIT in store.ts. Oldest entries are dropped. */
  history: TaskAttempt[];
  evidence?: TaskEvidence;
  review_gates: ReviewGate[];
  error_summary?: string;
  blocked_reason?: string;
  escalation?: { from: Role | string; to: Role | string; reason: string; at: string };
  tokens_estimated?: { input: number; output: number };
  cost_estimated_usd?: number;
  created_at: string;
  updated_at: string;
}

/** A planning contribution. Stored outside project.json to keep it small. */
export interface PlanProposal {
  title: string;
  objective: string;
  module?: string;
  functionality?: string;
  allowed_files?: string[];
  acceptance_criteria?: string[];
  verification?: string;
  /** Reference either an existing task id or another proposal's `ref`. */
  depends_on?: string[];
  /** Local handle so proposals in the same batch can depend on each other. */
  ref?: string;
  priority?: number;
  owner?: Role | string;
}

export interface Plan {
  id: string;
  author: Role | string;
  scope: string;
  summary: string;
  proposals: PlanProposal[];
  risks: string[];
  open_questions: string[];
  applied: boolean;
  applied_task_ids: string[];
  at: string;
}

/** Compact plan reference kept inside project.json. */
export interface PlanRef {
  id: string;
  author: Role | string;
  scope: string;
  proposals: number;
  applied: boolean;
  at: string;
}

export type ProjectPhase = 'CLARIFYING' | 'PLANNING' | 'EXECUTING' | 'REVIEWING' | 'DONE';

export const PHASES: readonly ProjectPhase[] = ['CLARIFYING', 'PLANNING', 'EXECUTING', 'REVIEWING', 'DONE'];

export interface OpenQuestion {
  id: string;
  question: string;
  why: string;
  answer?: string;
  answered_at?: string;
}

export interface ProjectState {
  project_id: string;
  objective: string;
  phase: ProjectPhase;
  status: 'active' | 'paused' | 'completed';
  counters: Record<string, number>;
  /** Compact refs only. Full plans live in .agent-foundry/plans/<id>.json. */
  plans: PlanRef[];
  /** Questions the orchestrator asked the human, with their answers. */
  questions: OpenQuestion[];
  /** Decisions the human made; agents must not silently override these. */
  human_decisions: string[];
  acceptance_anchors: string[];
  cost_totals_usd: number;
  tokens_total: number;
  created_at: string;
  updated_at: string;
}

export type FoundryEventType =
  | 'PROJECT_CREATED'
  | 'PROJECT_UPDATED'
  | 'PHASE_CHANGED'
  | 'QUESTION_ASKED'
  | 'QUESTION_ANSWERED'
  | 'PLAN_SUBMITTED'
  | 'PLAN_APPLIED'
  | 'TASK_CREATED'
  | 'TASK_UPDATED'
  | 'TASK_STATUS_CHANGED'
  | 'TASK_STARTED'
  | 'TASK_COMPLETED'
  | 'TASK_FAILED'
  | 'TASK_BLOCKED'
  | 'TASK_UNBLOCKED'
  | 'REVIEW_DECIDED'
  | 'ESCALATION_RAISED'
  | 'COST_RECORDED'
  | 'SCHEDULER_DECISION'
  | 'DESKTOP_OPENED'
  | 'DESKTOP_CLOSED';

export interface FoundryEvent {
  seq: number;
  at: string;
  type: FoundryEventType;
  actor: Role | string;
  task?: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface SchedulerDecision {
  ready: string[];
  started: string[];
  deferred: Array<{ id: string; reason: string }>;
  running: number;
  limit: number;
}
