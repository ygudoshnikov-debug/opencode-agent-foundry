import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  normalizeStatus,
  type FoundryEvent,
  type FoundryEventType,
  type Plan,
  type ProjectState,
  type Role,
  type Task,
} from './types.js';

export const FOUNDRY_DIR = '.agent-foundry';

/** Attempts kept per task. Older ones are dropped: they are pure token cost. */
export const HISTORY_LIMIT = 3;

/** Longest evidence summary persisted. Executors sometimes paste whole logs. */
export const OUTPUT_SUMMARY_LIMIT = 1200;

function now(): string {
  return new Date().toISOString();
}

function readJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/**
 * Write-then-rename so a crash mid-write cannot leave a truncated JSON file
 * that would silently reset project state on the next read.
 */
function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value)}\n`, 'utf8');
  renameSync(tmp, path);
}

function clampText(text: string | undefined, limit: number): string | undefined {
  if (text === undefined) return undefined;
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}… [truncated ${text.length - limit} chars]`;
}

/**
 * Normalises a task read from disk. Absorbs the v1 on-disk format (extra
 * statuses, missing `anchors`, unbounded history) so existing
 * `.agent-foundry/` directories keep working after the upgrade.
 */
function normalizeTask(raw: Partial<Task> & { id: string }): Task {
  const history = Array.isArray(raw.history) ? raw.history.slice(-HISTORY_LIMIT) : [];
  return {
    id: raw.id,
    title: raw.title ?? raw.id,
    objective: raw.objective ?? '',
    module: raw.module,
    functionality: raw.functionality,
    status: normalizeStatus(raw.status as string | undefined),
    priority: typeof raw.priority === 'number' ? raw.priority : 5,
    owner: raw.owner ?? 'analyst',
    executor: raw.executor ?? 'builder',
    depends_on: raw.depends_on ?? [],
    blocks: raw.blocks ?? [],
    related_to: raw.related_to ?? [],
    parent_task: raw.parent_task,
    child_tasks: raw.child_tasks ?? [],
    allowed_files: raw.allowed_files ?? [],
    acceptance_criteria: raw.acceptance_criteria ?? [],
    verification: raw.verification,
    anchors: raw.anchors ?? [],
    attempts: typeof raw.attempts === 'number' ? raw.attempts : 0,
    history,
    evidence: raw.evidence,
    review_gates: raw.review_gates ?? [],
    error_summary: raw.error_summary,
    blocked_reason: raw.blocked_reason,
    escalation: raw.escalation,
    tokens_estimated: raw.tokens_estimated,
    cost_estimated_usd: raw.cost_estimated_usd,
    created_at: raw.created_at ?? now(),
    updated_at: raw.updated_at ?? now(),
  };
}

/**
 * File-backed store. Layout:
 *
 *   <project>/.agent-foundry/
 *     project.json      objective, phase, counters, plan refs, questions, cost
 *     tasks/<ID>.json   authoritative task nodes
 *     plans/<ID>.json   full planning payloads (kept OUT of project.json)
 *     events.jsonl      append-only audit log
 *     desktop.json      bridge handshake (written only while the UI runs)
 *
 * `tasks/` is the source of truth. Everything else is derived or auxiliary.
 * The store caches project.json in memory for the lifetime of one operation
 * so a bulk create does not rewrite it once per task.
 */
export class FoundryStore {
  readonly dir: string;
  readonly tasksDir: string;
  readonly plansDir: string;
  private readonly eventsPath: string;
  private projectCache: ProjectState | null = null;
  private projectDirty = false;
  private seqCache: number | null = null;
  /** Size of events.jsonl as this instance last left it. See appendEvent. */
  private lastWrittenSize = -1;

  constructor(projectDir: string) {
    this.dir = join(projectDir, FOUNDRY_DIR);
    this.tasksDir = join(this.dir, 'tasks');
    this.plansDir = join(this.dir, 'plans');
    this.eventsPath = join(this.dir, 'events.jsonl');
  }

  exists(): boolean {
    return existsSync(join(this.dir, 'project.json'));
  }

  init(objective: string): ProjectState {
    mkdirSync(this.tasksDir, { recursive: true });
    mkdirSync(this.plansDir, { recursive: true });
    const project: ProjectState = {
      project_id: 'FOUNDRY-001',
      objective,
      phase: 'CLARIFYING',
      status: 'active',
      counters: {},
      plans: [],
      questions: [],
      human_decisions: [],
      acceptance_anchors: [],
      cost_totals_usd: 0,
      tokens_total: 0,
      created_at: now(),
      updated_at: now(),
    };
    this.projectCache = project;
    this.projectDirty = true;
    this.flush();
    if (!existsSync(this.eventsPath)) writeFileSync(this.eventsPath, '', 'utf8');
    this.appendEvent({ type: 'PROJECT_CREATED', actor: 'orchestrator', message: objective });
    return project;
  }

  /** Loads project.json once per store instance and migrates v1 fields. */
  loadProject(): ProjectState | null {
    if (this.projectCache) return this.projectCache;
    const raw = readJson<Partial<ProjectState> & Record<string, unknown>>(
      join(this.dir, 'project.json'),
      null as unknown as Partial<ProjectState>,
    );
    if (!raw) return null;
    // v1 stored full `subplans` inline; drop them to a compact ref list.
    const legacyPlans = Array.isArray(raw['subplans']) ? (raw['subplans'] as unknown[]) : [];
    const project: ProjectState = {
      project_id: raw.project_id ?? 'FOUNDRY-001',
      objective: raw.objective ?? '',
      phase: raw.phase ?? 'EXECUTING',
      status: raw.status ?? 'active',
      counters: raw.counters ?? {},
      plans:
        raw.plans ??
        legacyPlans.map((plan, index) => {
          const p = plan as Record<string, unknown>;
          return {
            id: `LEGACY-${String(index + 1).padStart(3, '0')}`,
            author: String(p['author'] ?? 'architect'),
            scope: String(p['scope'] ?? ''),
            proposals: Array.isArray(p['proposed_tasks']) ? p['proposed_tasks'].length : 0,
            applied: true,
            at: String(p['at'] ?? now()),
          };
        }),
      questions: raw.questions ?? [],
      human_decisions: raw.human_decisions ?? [],
      acceptance_anchors: raw.acceptance_anchors ?? [],
      cost_totals_usd: raw.cost_totals_usd ?? 0,
      tokens_total: raw.tokens_total ?? 0,
      created_at: raw.created_at ?? now(),
      updated_at: raw.updated_at ?? now(),
    };
    this.projectCache = project;
    // A migrated legacy file must be rewritten so the bloat is actually gone.
    if (legacyPlans.length && !raw.plans) this.projectDirty = true;
    return project;
  }

  saveProject(project: ProjectState): void {
    this.projectCache = project;
    this.projectDirty = true;
  }

  /** Persists any pending project mutation. Call once per engine operation. */
  flush(): void {
    if (!this.projectDirty || !this.projectCache) return;
    mkdirSync(this.dir, { recursive: true });
    this.projectCache.updated_at = now();
    writeJsonAtomic(join(this.dir, 'project.json'), this.projectCache);
    this.projectDirty = false;
  }

  listTaskIds(): string[] {
    if (!existsSync(this.tasksDir)) return [];
    return readdirSync(this.tasksDir)
      .filter((name) => name.endsWith('.json') && !name.endsWith('.tmp'))
      .map((name) => name.slice(0, -5))
      .sort();
  }

  loadAllTasks(): Task[] {
    return this.listTaskIds()
      .map((id) => this.loadTask(id))
      .filter((task): task is Task => task !== null)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  loadTask(id: string): Task | null {
    const raw = readJson<(Partial<Task> & { id?: string }) | null>(join(this.tasksDir, `${id}.json`), null);
    if (!raw) return null;
    return normalizeTask({ ...raw, id: raw.id ?? id });
  }

  saveTask(task: Task): void {
    mkdirSync(this.tasksDir, { recursive: true });
    task.updated_at = now();
    if (task.history.length > HISTORY_LIMIT) task.history = task.history.slice(-HISTORY_LIMIT);
    for (const attempt of task.history) {
      if (attempt.evidence?.output_summary) {
        attempt.evidence.output_summary = clampText(attempt.evidence.output_summary, OUTPUT_SUMMARY_LIMIT);
      }
    }
    if (task.evidence?.output_summary) {
      task.evidence.output_summary = clampText(task.evidence.output_summary, OUTPUT_SUMMARY_LIMIT);
    }
    writeJsonAtomic(join(this.tasksDir, `${task.id}.json`), task);
  }

  /**
   * Allocates `count` sequential ids under `prefix` in one shot. Bulk creation
   * therefore touches the counter once instead of once per task.
   */
  allocateIds(prefix: string, count: number): string[] {
    const project = this.loadProject();
    const scope = (prefix || 'TASK').toUpperCase().replace(/[^A-Z0-9_-]/g, '') || 'TASK';
    const start = (project?.counters[scope] ?? 0) + 1;
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) ids.push(`${scope}-${String(start + i).padStart(3, '0')}`);
    if (project) {
      project.counters[scope] = start + count - 1;
      this.saveProject(project);
    }
    return ids;
  }

  nextId(prefix: string): string {
    return this.allocateIds(prefix, 1)[0]!;
  }

  savePlan(plan: Plan): void {
    mkdirSync(this.plansDir, { recursive: true });
    writeJsonAtomic(join(this.plansDir, `${plan.id}.json`), plan);
  }

  loadPlan(id: string): Plan | null {
    return readJson<Plan | null>(join(this.plansDir, `${id}.json`), null);
  }

  /**
   * Appends one event.
   *
   * The sequence number is cached so a long run does not re-read the whole log
   * on every write — but the cache is only trusted while the file is exactly as
   * this instance left it. Several stores can point at the same directory (the
   * engine makes one per tool call, the bridge one per request), and a stale
   * cache would hand out a sequence number another writer already used, which
   * the desktop stream would then silently discard as a duplicate. Comparing
   * the file size is cheap and catches every foreign write.
   */
  appendEvent(input: {
    type: FoundryEventType;
    actor: Role | string;
    task?: string;
    message: string;
    data?: Record<string, unknown>;
  }): FoundryEvent {
    mkdirSync(this.dir, { recursive: true });
    if (this.seqCache === null || this.eventsSize() !== this.lastWrittenSize) {
      this.seqCache = this.countEvents();
    }
    this.seqCache += 1;
    const event: FoundryEvent = { seq: this.seqCache, at: now(), ...input };
    appendFileSync(this.eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
    this.lastWrittenSize = this.eventsSize();
    return event;
  }

  private eventsSize(): number {
    try {
      return existsSync(this.eventsPath) ? statSync(this.eventsPath).size : 0;
    } catch {
      return -1;
    }
  }

  private countEvents(): number {
    try {
      if (!existsSync(this.eventsPath)) return 0;
      if (statSync(this.eventsPath).size === 0) return 0;
      const content = readFileSync(this.eventsPath, 'utf8');
      let lines = 0;
      for (let i = 0; i < content.length; i += 1) if (content.charCodeAt(i) === 10) lines += 1;
      return content.endsWith('\n') ? lines : lines + 1;
    } catch {
      return 0;
    }
  }

  /** Most recent `limit` events, oldest first. Malformed lines are skipped. */
  readEvents(limit = 100): FoundryEvent[] {
    if (!existsSync(this.eventsPath)) return [];
    const lines = readFileSync(this.eventsPath, 'utf8').split('\n').filter(Boolean);
    const out: FoundryEvent[] = [];
    for (const line of lines.slice(-limit)) {
      try {
        out.push(JSON.parse(line) as FoundryEvent);
      } catch {
        /* skip corrupt line */
      }
    }
    return out;
  }

  /** Path helper for auxiliary files (desktop handshake, lock files). */
  path(name: string): string {
    return join(this.dir, name);
  }

  ensureDir(): void {
    mkdirSync(this.dir, { recursive: true });
  }
}
