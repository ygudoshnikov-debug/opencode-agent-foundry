import { buildBoard, progressOf, summarize } from '../core/board.js';
import { WorkGraph } from '../core/graph.js';
import { FoundryStore } from '../core/store.js';
import {
  GATE_ORDER,
  KANBAN_COLUMNS,
  type FoundryEventType,
  type GateName,
  type OpenQuestion,
  type Plan,
  type PlanProposal,
  type ProjectPhase,
  type ProjectState,
  type Role,
  type Task,
  type TaskEvidence,
  type TaskStatus,
} from '../core/types.js';
import { computeSchedule } from '../orchestration/scheduler.js';
import {
  anchorViolations,
  decideOnFailure,
  gatesRemaining,
  requiredGatesFor,
  validateCompletion,
} from '../orchestration/validator.js';
import { checkCostLimits, escalationTarget, estimateCost, estimateTokensForTask } from '../orchestration/router.js';
import { buildPacket } from '../context/packet.js';
import { loadConfig, setRoleModel } from '../config/loader.js';
import { delegate, delegateMany, type DelegationOutcome } from '../orchestration/delegation.js';
import { OFFLINE_HOST, type Host } from '../runtime/host.js';
import { applySetup, runtimeView, type SetupInput, type SetupOutcome, type SetupRequest } from '../runtime/setup.js';
import { CONFIGURABLE_ROLES, type ConfigurableRole, type FoundryConfig } from '../config/schema.js';
import type { Board, ConfigView, DoctorReport, GraphView, ProjectSummary, RuntimeView } from '../desktop/protocol.js';

/**
 * The engine holds every state transition. Tool definitions are a thin wrapper
 * over it, the CLI calls it directly, and the desktop bridge reads through it,
 * so all three surfaces cannot disagree.
 *
 * Return values are deliberately small. Everything here is read by a language
 * model at some point, and returning whole task documents — history, evidence,
 * gates and all — was the dominant token cost in the previous design.
 */

export interface EngineOptions {
  /** Overrides config loading. Used by tests. */
  config?: FoundryConfig;
  /**
   * How the engine reaches OpenCode: the model catalogue, the current chat
   * model, and running a role. Defaults to an offline host so every code path
   * stays testable and headless use never touches the network.
   */
  host?: Host;
  /**
   * Shared with the desktop bridge so a chat session asking for the setup
   * screen and the window that answers it are talking about the same request.
   */
  setupRequest?: SetupRequest;
}

export interface Engine {
  start(objective: string): unknown;
  ask(questions: Array<{ question: string; why: string }>): unknown;
  answer(answers: Array<{ id: string; answer: string }>): unknown;
  planSubmit(input: {
    author: Role | string;
    scope: string;
    summary: string;
    proposals: PlanProposal[];
    risks?: string[];
    open_questions?: string[];
  }): unknown;
  planApply(planId: string, prefix?: string): unknown;
  taskCreate(input: PlanProposal & { executor?: string }): unknown;
  taskUpdate(id: string, patch: Partial<Task>): unknown;
  taskShow(id: string, detail?: boolean): unknown;
  taskList(filter?: { status?: string; module?: string; limit?: number }): unknown;
  next(): unknown;
  taskStart(id: string, actor?: string): unknown;
  taskComplete(id: string, evidence: TaskEvidence, actor?: string): unknown;
  taskFail(id: string, errorSummary: string, actor?: string): unknown;
  review(id: string, gate: GateName, decision: 'passed' | 'rejected', reviewer: string, note?: string): unknown;
  escalate(id: string, from: string, reason: string): unknown;
  board(): Board;
  graph(action: 'show' | 'upstream' | 'downstream' | 'impact' | 'critical_path' | 'validate', id?: string): unknown;
  status(): ProjectSummary;
  doctor(): DoctorReport;
  configView(): ConfigView;
  setModel(role: ConfigurableRole, model: string): unknown;
  events(limit?: number): unknown;
  graphView(): GraphView;
  runtime(): Promise<RuntimeView>;
  /** Raises the flag that makes the desktop open on its setup screen. */
  requestSetup(): void;
  setup(input: SetupInput): Promise<SetupOutcome>;
  delegateRole(input: {
    role: ConfigurableRole;
    sessionID: string;
    directory: string;
    taskId?: string;
    brief?: string;
    signal?: AbortSignal;
  }): Promise<unknown>;
  executeReady(input: { sessionID: string; directory: string; signal?: AbortSignal }): Promise<unknown>;
}

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  orchestrator: 'Coordinates the whole flow and talks to you. Always uses the model selected in the chat.',
  architect: 'Project-wide architecture and sequencing.',
  lead: 'One module: contracts and decomposition.',
  analyst: 'One functionality: precise tasks and review.',
  builder: 'One task: implementation with evidence.',
};

function actorOf(name?: string): string {
  return name?.trim() || 'orchestrator';
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Cleans a free-text objective before it is stored.
 *
 * Models routinely pass the user's sentence still wrapped in the quotes it was
 * quoted with, and that wrapper then shows up in the board header, the desktop
 * dashboard and every status report.
 */
function cleanObjective(raw: string): string {
  let text = raw.trim();
  while (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    const paired =
      (first === '"' && last === '"') ||
      (first === "'" && last === "'") ||
      (first === '`' && last === '`') ||
      (first === '“' && last === '”');
    if (!paired) break;
    text = text.slice(1, -1).trim();
  }
  return text;
}

export function createEngine(projectDir: string, options: EngineOptions = {}): Engine {
  const store = new FoundryStore(projectDir);
  const host = options.host ?? OFFLINE_HOST;
  const setupRequest = options.setupRequest;
  let configCache: FoundryConfig | null = options.config ?? null;
  let sourcesCache: string[] = [];

  const config = (): FoundryConfig => {
    if (configCache) return configCache;
    const loaded = loadConfig(projectDir);
    configCache = loaded.config;
    sourcesCache = loaded.sources;
    return configCache;
  };

  const requireProject = (): ProjectState => {
    const project = store.loadProject();
    if (!project) throw new Error('Foundry is not initialised here. Call foundry_start with the objective first.');
    return project;
  };

  /**
   * Refuses an out-of-order transition.
   *
   * The flow used to live only in the orchestrator's prompt, which meant a
   * model that lost the thread could complete a task it never started, review
   * one that was still running, or apply a plan while its own questions sat
   * unanswered — each producing a board that lies about what happened. The
   * message names the state and the correct next call, so the model recovers
   * in one turn instead of guessing.
   */
  const refuse = (what: string, why: string, next: string): never => {
    throw new Error(`${what}: ${why}. ${next}`);
  };

  /**
   * There is nothing to execute before a plan has produced tasks. Refusing here
   * rather than returning an empty schedule stops the orchestrator from reading
   * "no work ready" as "the work is finished".
   */
  const requireExecutable = (project: ProjectState): void => {
    if (project.phase === 'CLARIFYING' || project.phase === 'PLANNING') {
      refuse(
        'Nothing to execute yet',
        `the project is still ${project.phase}`,
        project.phase === 'CLARIFYING'
          ? 'Record the answers with foundry_answer, then plan.'
          : 'Produce a plan with foundry_plan and apply it with foundry_apply_plan.',
      );
    }
  };

  const log = (
    type: FoundryEventType,
    actor: Role | string,
    message: string,
    task?: string,
    data?: Record<string, unknown>,
  ): void => {
    store.appendEvent({ type, actor, message, ...(task ? { task } : {}), ...(data ? { data } : {}) });
  };

  const setPhase = (project: ProjectState, phase: ProjectPhase): void => {
    if (project.phase === phase) return;
    const from = project.phase;
    project.phase = phase;
    store.saveProject(project);
    log('PHASE_CHANGED', 'orchestrator', `${from} → ${phase}`, undefined, { from, to: phase });
  };

  /**
   * Recomputes derived statuses after a change. Runs once over the whole board
   * with a single graph, rather than rebuilding the graph per dependent.
   */
  const propagate = (changedId: string): string[] => {
    const tasks = store.loadAllTasks();
    const graph = new WorkGraph(tasks);
    const moved: string[] = [];
    for (const task of tasks) {
      if (!task.depends_on.includes(changedId)) continue;
      const gate = graph.isUnblocked(task);
      if (gate.ok && (task.status === 'BLOCKED' || task.status === 'PLANNED')) {
        const from = task.status;
        task.status = 'READY';
        task.blocked_reason = undefined;
        store.saveTask(task);
        moved.push(task.id);
        log('TASK_UNBLOCKED', 'orchestrator', `${task.id}: ${from} → READY (${changedId} satisfied)`, task.id);
      } else if (!gate.ok && task.status === 'READY') {
        task.status = 'BLOCKED';
        task.blocked_reason = `waiting for ${gate.waiting_for.join(', ')}`;
        store.saveTask(task);
        moved.push(task.id);
        log('TASK_BLOCKED', 'orchestrator', `${task.id}: READY → BLOCKED`, task.id);
      }
    }
    return moved;
  };

  const upsertGate = (
    task: Task,
    gate: GateName,
    status: 'pending' | 'passed' | 'rejected' | 'skipped',
    reviewer: string,
    note?: string,
  ): void => {
    const existing = task.review_gates.find((entry) => entry.gate === gate);
    if (existing) {
      existing.status = status;
      existing.reviewer = reviewer;
      existing.at = nowIso();
      existing.note = note;
      return;
    }
    task.review_gates.push({ gate, status, reviewer, at: nowIso(), ...(note ? { note } : {}) });
  };

  const ensureGates = (task: Task, required: readonly GateName[]): void => {
    for (const gate of required) {
      if (!task.review_gates.some((entry) => entry.gate === gate)) {
        task.review_gates.push({ gate, status: 'pending' });
      }
    }
    task.review_gates.sort((a, b) => GATE_ORDER.indexOf(a.gate) - GATE_ORDER.indexOf(b.gate));
  };

  const makeTask = (id: string, proposal: PlanProposal & { executor?: string }): Task => {
    const at = nowIso();
    return {
      id,
      title: proposal.title,
      objective: proposal.objective,
      ...(proposal.module ? { module: proposal.module } : {}),
      ...(proposal.functionality ? { functionality: proposal.functionality } : {}),
      status: 'PLANNED',
      priority: Math.min(9, Math.max(1, proposal.priority ?? 5)),
      owner: proposal.owner ?? 'analyst',
      executor: proposal.executor ?? 'builder',
      depends_on: proposal.depends_on ?? [],
      blocks: [],
      related_to: [],
      child_tasks: [],
      allowed_files: proposal.allowed_files ?? [],
      acceptance_criteria: proposal.acceptance_criteria ?? [],
      ...(proposal.verification ? { verification: proposal.verification } : {}),
      anchors: [],
      attempts: 0,
      history: [],
      review_gates: [
        { gate: 'execution', status: 'pending' },
        { gate: 'test', status: 'pending' },
        { gate: 'review', status: 'pending' },
      ],
      created_at: at,
      updated_at: at,
    };
  };

  const engine: Engine = {
    start(objective) {
      const cleaned = cleanObjective(objective);
      const existing = store.loadProject();
      if (existing) {
        if (cleaned && cleaned !== existing.objective) {
          existing.objective = cleaned;
          store.saveProject(existing);
          log('PROJECT_UPDATED', 'orchestrator', `objective updated: ${existing.objective}`);
        }
        store.flush();
        return {
          created: false,
          objective: existing.objective,
          phase: existing.phase,
          open_questions: existing.questions.filter((question) => !question.answer).length,
          tasks: store.listTaskIds().length,
          next: 'Board already exists. Use foundry_status to see where it stands.',
        };
      }
      const project = store.init(cleaned);
      store.flush();
      return {
        created: true,
        objective: project.objective,
        phase: project.phase,
        next: 'Identify what is genuinely unclear, record it with foundry_ask, and ask the human in one message.',
      };
    },

    ask(questions) {
      const project = requireProject();
      const created: OpenQuestion[] = [];
      for (const item of questions) {
        const id = `Q${String(project.questions.length + created.length + 1).padStart(2, '0')}`;
        created.push({ id, question: item.question, why: item.why });
      }
      project.questions.push(...created);
      setPhase(project, 'CLARIFYING');
      store.saveProject(project);
      for (const question of created) {
        log('QUESTION_ASKED', 'orchestrator', question.question, undefined, { id: question.id });
      }
      store.flush();
      return {
        asked: created.map((question) => ({ id: question.id, question: question.question })),
        next: 'Present these to the human as one numbered list, then record replies with foundry_answer.',
      };
    },

    answer(answers) {
      const project = requireProject();
      const applied: string[] = [];
      const unknown: string[] = [];
      for (const item of answers) {
        const question = project.questions.find((entry) => entry.id === item.id);
        if (!question) {
          unknown.push(item.id);
          continue;
        }
        question.answer = item.answer;
        question.answered_at = nowIso();
        project.human_decisions.push(`${question.question} → ${item.answer}`);
        applied.push(question.id);
        log('QUESTION_ANSWERED', 'human', `${question.id}: ${item.answer}`, undefined, { id: question.id });
      }
      const remaining = project.questions.filter((question) => !question.answer).length;
      if (remaining === 0) setPhase(project, 'PLANNING');
      store.saveProject(project);
      store.flush();
      return {
        applied,
        ...(unknown.length ? { unknown } : {}),
        open_questions: remaining,
        phase: project.phase,
        next: remaining === 0 ? 'Get the shape decided with foundry_consult, then record it with foundry_plan.' : 'Still waiting on answers.',
      };
    },

    planSubmit(input) {
      const project = requireProject();
      const id = `PLAN-${String(project.plans.length + 1).padStart(3, '0')}`;
      const plan: Plan = {
        id,
        author: input.author,
        scope: input.scope,
        summary: input.summary,
        proposals: input.proposals,
        risks: input.risks ?? [],
        open_questions: input.open_questions ?? [],
        applied: false,
        applied_task_ids: [],
        at: nowIso(),
      };
      // Full payload lives in plans/; project.json keeps only a compact ref.
      store.savePlan(plan);
      project.plans.push({
        id,
        author: plan.author,
        scope: plan.scope,
        proposals: plan.proposals.length,
        applied: false,
        at: plan.at,
      });
      setPhase(project, 'PLANNING');
      store.saveProject(project);
      log('PLAN_SUBMITTED', input.author, `${id} (${plan.proposals.length} proposals) for ${plan.scope}`, undefined, {
        plan: id,
      });
      store.flush();

      // Planning that never becomes work is the single most expensive kind of
      // waste: it is paid for in full and produces nothing. The tic-tac-toe run
      // accumulated four overlapping plans this way. Surface any earlier plan
      // still sitting unapplied so the orchestrator resolves it now.
      const stranded = project.plans.filter((entry) => !entry.applied && entry.id !== id);

      return {
        plan: id,
        proposals: plan.proposals.length,
        risks: plan.risks.length,
        open_questions: plan.open_questions,
        ...(stranded.length
          ? {
              unapplied_plans: stranded.map((entry) => `${entry.id} (${entry.author}, ${entry.scope})`),
              warning:
                'Earlier plans were never applied. Apply them or supersede them deliberately — a plan that is paid for and discarded is pure waste.',
            }
          : {}),
        next: `Apply it with foundry_apply_plan when the scope is settled.`,
      };
    },

    planApply(planId, prefix) {
      const project = requireProject();
      const unanswered = project.questions.filter((question) => !question.answer).map((question) => question.id);
      if (unanswered.length) {
        refuse(
          `Cannot apply ${planId}`,
          `${unanswered.join(', ')} still unanswered`,
          'Put the questions to the human and record the answers with foundry_answer first — a plan built on a guess costs more to undo than to delay.',
        );
      }
      const plan = store.loadPlan(planId);
      if (!plan) throw new Error(`Unknown plan ${planId}`);
      if (plan.applied) {
        return { plan: planId, created: [], skipped: 'already applied', tasks: plan.applied_task_ids };
      }

      const existing = new Set(store.listTaskIds());
      const ids = store.allocateIds(prefix ?? 'TASK', plan.proposals.length);
      // Local refs let a plan express internal ordering before ids exist.
      const refToId = new Map<string, string>();
      plan.proposals.forEach((proposal, index) => {
        if (proposal.ref) refToId.set(proposal.ref, ids[index]!);
      });

      const created: Task[] = [];
      const warnings: string[] = [];
      plan.proposals.forEach((proposal, index) => {
        const id = ids[index]!;
        const resolved = (proposal.depends_on ?? [])
          .map((dep) => refToId.get(dep) ?? dep)
          .filter((dep) => {
            if (dep === id) return false;
            if (existing.has(dep) || [...refToId.values()].includes(dep)) return true;
            warnings.push(`${id}: dropped unknown dependency ${dep}`);
            return false;
          });
        created.push(makeTask(id, { ...proposal, depends_on: resolved, owner: proposal.owner ?? plan.author }));
      });

      for (const task of created) {
        store.saveTask(task);
        log('TASK_CREATED', task.owner, `${task.id} ${task.title}`, task.id);
      }

      plan.applied = true;
      plan.applied_task_ids = created.map((task) => task.id);
      store.savePlan(plan);
      const ref = project.plans.find((entry) => entry.id === planId);
      if (ref) ref.applied = true;
      setPhase(project, 'EXECUTING');
      store.saveProject(project);
      log('PLAN_APPLIED', plan.author, `${planId} → ${created.length} tasks`, undefined, { plan: planId });

      // Immediately mark whatever is already runnable, so foundry_next is useful.
      const all = store.loadAllTasks();
      const graph = new WorkGraph(all);
      for (const task of all) {
        if (task.status !== 'PLANNED') continue;
        const gate = graph.isUnblocked(task);
        if (gate.ok) {
          task.status = 'READY';
          store.saveTask(task);
        } else if (gate.waiting_for.length) {
          task.blocked_reason = `waiting for ${gate.waiting_for.join(', ')}`;
          store.saveTask(task);
        }
      }

      const overlaps = graph.fileOverlaps();
      for (const overlap of overlaps) {
        warnings.push(`${overlap.a} and ${overlap.b} both claim ${overlap.files.join(', ')} — they cannot run in parallel`);
      }

      store.flush();
      return {
        plan: planId,
        created: created.map((task) => ({ id: task.id, title: task.title, depends_on: task.depends_on })),
        ...(warnings.length ? { warnings } : {}),
        next: 'Run foundry_doctor, fix every error, then foundry_execute.',
      };
    },

    taskCreate(input) {
      requireProject();
      const id = store.nextId(input.module ?? 'TASK');
      const task = makeTask(id, input);
      const graph = new WorkGraph([...store.loadAllTasks(), task]);
      if (graph.isUnblocked(task).ok) task.status = 'READY';
      store.saveTask(task);
      log('TASK_CREATED', task.owner, `${task.id} ${task.title}`, task.id);
      store.flush();
      return { id: task.id, title: task.title, status: task.status, depends_on: task.depends_on };
    },

    taskUpdate(id, patch) {
      requireProject();
      const tasks = store.loadAllTasks();
      const task = tasks.find((entry) => entry.id === id);
      if (!task) throw new Error(`Unknown task ${id}`);

      const violations = anchorViolations(task, patch);
      if (violations.length) {
        return {
          id,
          refused: true,
          reason: `anchored values cannot be rewritten: ${violations.join('; ')}`,
          next: 'Escalate with foundry_escalate, or ask the human to change the decision.',
        };
      }

      // A status is not a free-form field. Moving a task into a runnable column
      // while its dependencies are unmet would show it as READY on the board and
      // then silently block it the moment anything tried to start it, so the
      // dependency gate is enforced here and not only in taskStart.
      if (patch.status === 'READY' || patch.status === 'IN_PROGRESS') {
        const candidate = { ...task, ...patch } as Task;
        const gate = new WorkGraph(tasks.map((entry) => (entry.id === id ? candidate : entry))).isUnblocked(candidate);
        if (!gate.ok) {
          return {
            id,
            refused: true,
            reason: `${id} still depends on ${gate.waiting_for.join(', ')}`,
            next: 'Finish the dependencies first, or remove them with depends_on.',
          };
        }
      }

      const from = task.status;
      const safe = { ...patch };
      delete (safe as Record<string, unknown>)['id'];
      delete (safe as Record<string, unknown>)['created_at'];
      delete (safe as Record<string, unknown>)['history'];
      Object.assign(task, safe);
      store.saveTask(task);

      let moved: string[] = [];
      if (patch.status && patch.status !== from) {
        log('TASK_STATUS_CHANGED', actorOf(String(task.owner)), `${id}: ${from} → ${task.status}`, id, {
          from,
          to: task.status,
        });
        moved = propagate(id);
      } else {
        log('TASK_UPDATED', actorOf(String(task.owner)), `${id} updated`, id);
      }
      store.flush();
      return { id, status: task.status, ...(moved.length ? { also_changed: moved } : {}) };
    },

    taskShow(id, detail = false) {
      requireProject();
      const tasks = store.loadAllTasks();
      const task = tasks.find((entry) => entry.id === id);
      if (!task) throw new Error(`Unknown task ${id}`);
      const graph = new WorkGraph(tasks);
      const base = {
        ...summarize(task, graph),
        objective: task.objective,
        allowed_files: task.allowed_files,
        acceptance_criteria: task.acceptance_criteria,
        verification: task.verification,
        anchors: task.anchors,
        gates: task.review_gates.map((gate) => `${gate.gate}:${gate.status}`),
        error_summary: task.error_summary,
        blocked_reason: task.blocked_reason,
        upstream: graph.upstream(id),
        downstream: graph.downstream(id),
      };
      // History and evidence are large; only send them when explicitly asked.
      return detail ? { ...base, history: task.history, evidence: task.evidence, escalation: task.escalation } : base;
    },

    taskList(filter = {}) {
      requireProject();
      const tasks = store.loadAllTasks();
      const graph = new WorkGraph(tasks);
      let filtered = tasks;
      if (filter.status) {
        const wanted = filter.status.toUpperCase();
        filtered = filtered.filter((task) => task.status === wanted);
      }
      if (filter.module) filtered = filtered.filter((task) => task.module === filter.module);
      const limit = filter.limit ?? 100;
      return {
        total: filtered.length,
        tasks: filtered.slice(0, limit).map((task) => summarize(task, graph)),
        ...(filtered.length > limit ? { truncated: filtered.length - limit } : {}),
      };
    },

    next() {
      const project = requireProject();
      requireExecutable(project);
      const tasks = store.loadAllTasks();
      const decision = computeSchedule(tasks, {
        maxParallel: config().execution.max_parallel,
        allowFileOverlap: config().execution.allow_file_overlap,
      });
      log(
        'SCHEDULER_DECISION',
        'orchestrator',
        `running ${decision.running}/${decision.limit} · start [${decision.started.join(', ')}]`,
        undefined,
        { started: decision.started, ready: decision.ready.length },
      );
      store.flush();

      if (!decision.ready.length && !decision.running) {
        const openReview = tasks.filter((task) => task.status === 'REVIEW').map((task) => task.id);
        const failed = tasks.filter((task) => task.status === 'FAILED').map((task) => task.id);
        const blocked = tasks.filter((task) => task.status === 'BLOCKED').map((task) => task.id);
        return {
          ...decision,
          idle: true,
          ...(openReview.length ? { awaiting_review: openReview } : {}),
          ...(failed.length ? { failed } : {}),
          ...(blocked.length ? { blocked } : {}),
          next:
            openReview.length || failed.length || blocked.length
              ? 'Nothing can start. Resolve reviews, failures and blockers first.'
              : project.phase === 'DONE'
                ? 'All work is complete.'
                : 'Board is empty — plan more work or confirm the objective is met.',
        };
      }

      return {
        ...decision,
        next: decision.started.length
          ? 'Run them with foundry_execute — it dispatches each builder itself.'
          : 'No free slot right now. Finish something in progress first.',
      };
    },

    taskStart(id, actor) {
      requireProject();
      const tasks = store.loadAllTasks();
      const task = tasks.find((entry) => entry.id === id);
      if (!task) throw new Error(`Unknown task ${id}`);
      const graph = new WorkGraph(tasks);
      const gate = graph.isUnblocked(task);
      if (!gate.ok) {
        task.status = 'BLOCKED';
        task.blocked_reason = `waiting for ${gate.waiting_for.join(', ')}`;
        store.saveTask(task);
        log('TASK_BLOCKED', actorOf(actor), `${id} blocked: ${task.blocked_reason}`, id);
        store.flush();
        return { id, status: task.status, blocked_reason: task.blocked_reason };
      }

      // Build the packet BEFORE persisting the status change. If packet
      // construction fails, the task must stay schedulable — marking it
      // IN_PROGRESS first would leave the board claiming work is running that
      // no executor ever received.
      const packet = buildPacket({
        project: requireProject(),
        task,
        graph,
        role: 'builder',
        config: config(),
      });

      const from = task.status;
      task.status = 'IN_PROGRESS';
      task.blocked_reason = undefined;
      store.saveTask(task);
      log('TASK_STARTED', actorOf(actor), `${id}: ${from} → IN_PROGRESS`, id, { from });
      store.flush();

      return {
        id,
        status: task.status,
        packet: packet.text,
        estimated_tokens: packet.estimated_tokens,
        next: 'Dispatched by foundry_execute; the packet is sent to the builder verbatim.',
      };
    },

    taskComplete(id, evidence, actor) {
      const project = requireProject();
      const tasks = store.loadAllTasks();
      const task = tasks.find((entry) => entry.id === id);
      if (!task) throw new Error(`Unknown task ${id}`);
      if (task.status !== 'IN_PROGRESS') {
        refuse(
          `Cannot complete ${id}`,
          `it is ${task.status}, not IN_PROGRESS`,
          task.status === 'REVIEW'
            ? 'It is already done and waiting on review — call foundry_review.'
            : 'Only work that actually ran can report evidence. Start it with foundry_execute.',
        );
      }
      const graph = new WorkGraph(tasks);
      const cfg = config();

      task.attempts += 1;
      task.evidence = evidence;
      const validation = validateCompletion(task, evidence, graph);

      const tokens = estimateTokensForTask(task);
      const cost = estimateCost(cfg, cfg.models.builder, tokens.input, tokens.output);
      task.tokens_estimated = tokens;
      task.cost_estimated_usd = cost;
      project.cost_totals_usd += cost;
      project.tokens_total += tokens.input + tokens.output;

      task.history.push({
        n: task.attempts,
        at: nowIso(),
        actor: actorOf(actor),
        result: validation.ok ? 'success' : 'failure',
        ...(validation.ok ? {} : { error_summary: validation.reasons.join('; ') }),
        evidence,
      });

      let decision: { decision: string; reason: string } | undefined;
      if (validation.ok) {
        task.status = 'REVIEW';
        task.error_summary = undefined;
        upsertGate(task, 'execution', 'passed', actorOf(actor), 'evidence recorded');
        upsertGate(task, 'test', 'passed', actorOf(actor), 'tests reported passing');
        ensureGates(task, validation.required_gates);
        log('TASK_COMPLETED', actorOf(actor), `${id} → REVIEW`, id, { gates: validation.required_gates });
      } else {
        task.status = 'FAILED';
        task.error_summary = validation.reasons.join('; ');
        upsertGate(task, 'execution', 'rejected', actorOf(actor), task.error_summary);
        decision = decideOnFailure(task, cfg.execution.max_retries);
        log('TASK_FAILED', actorOf(actor), `${id}: ${task.error_summary}`, id, { decision: decision.decision });
      }

      store.saveTask(task);
      store.saveProject(project);
      log('COST_RECORDED', actorOf(actor), `${id} ~$${cost.toFixed(4)}`, id, { cost, ...tokens });

      const guard = checkCostLimits(cfg, cost, project.cost_totals_usd);
      store.flush();

      return {
        id,
        status: task.status,
        ok: validation.ok,
        ...(validation.ok ? {} : { reasons: validation.reasons }),
        ...(decision ? { decision: decision.decision, decision_reason: decision.reason } : {}),
        pending_gates: gatesRemaining(task).map((gate) => gate.gate),
        cost_usd: Number(cost.toFixed(5)),
        ...(guard.ok ? {} : { cost_warning: guard.reason }),
        next: validation.ok
          ? 'Run the remaining gates with foundry_review.'
          : 'Fix the listed reasons and retry, or escalate.',
      };
    },

    taskFail(id, errorSummary, actor) {
      requireProject();
      const task = store.loadTask(id);
      if (!task) throw new Error(`Unknown task ${id}`);
      if (task.status !== 'IN_PROGRESS') {
        refuse(
          `Cannot fail ${id}`,
          `it is ${task.status}, not IN_PROGRESS`,
          'A task that never ran has nothing to report. Use foundry_task to change its status directly if that is what you mean.',
        );
      }
      task.attempts += 1;
      task.status = 'FAILED';
      task.error_summary = errorSummary;
      task.history.push({
        n: task.attempts,
        at: nowIso(),
        actor: actorOf(actor),
        result: 'failure',
        error_summary: errorSummary,
      });
      const decision = decideOnFailure(task, config().execution.max_retries);
      store.saveTask(task);
      log('TASK_FAILED', actorOf(actor), `${id}: ${errorSummary}`, id, { decision: decision.decision });
      store.flush();
      return { id, status: task.status, attempts: task.attempts, ...decision };
    },

    review(id, gate, decision, reviewer, note) {
      requireProject();
      const task = store.loadTask(id);
      if (!task) throw new Error(`Unknown task ${id}`);
      if (task.status !== 'REVIEW') {
        refuse(
          `Cannot review ${id}`,
          `it is ${task.status}, not REVIEW`,
          task.status === 'DONE'
            ? 'Its gates already passed.'
            : 'A task reaches review by reporting evidence through foundry_complete.',
        );
      }
      upsertGate(task, gate, decision, reviewer, note);

      let moved: string[] = [];
      if (decision === 'rejected') {
        task.status = 'IN_PROGRESS';
        task.error_summary = note ?? `${gate} gate rejected`;
        log('REVIEW_DECIDED', reviewer, `${id} ${gate} rejected: ${task.error_summary}`, id, { gate });
      } else {
        log('REVIEW_DECIDED', reviewer, `${id} ${gate} passed`, id, { gate });
        if (task.status === 'REVIEW' && gatesRemaining(task).length === 0) {
          task.status = 'DONE';
          log('TASK_STATUS_CHANGED', reviewer, `${id}: REVIEW → DONE (all gates passed)`, id, { to: 'DONE' });
        }
      }
      store.saveTask(task);
      if (task.status === 'DONE') moved = propagate(id);

      // Everything finished? Move the project on so the orchestrator can close out.
      const project = requireProject();
      const all = store.loadAllTasks();
      if (all.length && all.every((entry) => entry.status === 'DONE' || entry.status === 'CANCELLED')) {
        setPhase(project, 'REVIEWING');
      }
      store.flush();

      return {
        id,
        status: task.status,
        pending_gates: gatesRemaining(task).map((entry) => entry.gate),
        ...(moved.length ? { unblocked: moved } : {}),
      };
    },

    escalate(id, from, reason) {
      requireProject();
      const task = store.loadTask(id);
      if (!task) throw new Error(`Unknown task ${id}`);
      const to = escalationTarget(from) ?? 'architect';
      task.escalation = { from, to, reason, at: nowIso() };
      task.status = 'BLOCKED';
      task.blocked_reason = `escalated to ${to}: ${reason}`;
      store.saveTask(task);
      log('ESCALATION_RAISED', from, `${id}: ${from} → ${to}: ${reason}`, id, { from, to });
      store.flush();
      return { id, status: task.status, escalated_to: to, next: `Delegate the decision to @${to}.` };
    },

    board() {
      requireProject();
      return buildBoard(store.loadAllTasks());
    },

    graph(action, id) {
      requireProject();
      const graph = new WorkGraph(store.loadAllTasks());
      if (action === 'validate') return graph.validate();
      if (action === 'critical_path') return graph.criticalPath();
      if (action === 'show') {
        const edges = graph.edges();
        return { count: graph.tasks.size, edges: edges.slice(0, 200), truncated: Math.max(0, edges.length - 200) };
      }
      if (!id) throw new Error(`graph ${action} needs a task id`);
      if (!graph.tasks.has(id)) throw new Error(`Unknown task ${id}`);
      if (action === 'upstream') return { id, upstream: graph.upstream(id) };
      if (action === 'downstream') return { id, downstream: graph.downstream(id) };
      return { id, ...graph.impact(id) };
    },

    graphView(): GraphView {
      requireProject();
      const graph = new WorkGraph(store.loadAllTasks());
      const topo = graph.topoOrder();
      return {
        edges: graph.edges(),
        critical_path: graph.criticalPath().path,
        cycles: graph.detectCycles(),
        missing: graph.missingDeps(),
        order: topo.order,
      };
    },

    status(): ProjectSummary {
      const project = store.loadProject();
      if (!project) {
        return {
          initialized: false,
          totals: { tasks: 0, by_status: {} },
          running: [],
          blocked: [],
          open_questions: [],
          critical_path: [],
          progress: { done: 0, total: 0, percent: 0 },
          cost_usd: 0,
          tokens: 0,
          plans: 0,
          hint: 'Call foundry_start with the objective.',
        };
      }
      const tasks = store.loadAllTasks();
      const graph = new WorkGraph(tasks);
      const byStatus: Record<string, number> = {};
      for (const status of KANBAN_COLUMNS) byStatus[status] = 0;
      for (const task of tasks) byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;
      return {
        initialized: true,
        project_id: project.project_id,
        objective: project.objective,
        phase: project.phase,
        status: project.status,
        totals: { tasks: tasks.length, by_status: byStatus },
        running: tasks.filter((task) => task.status === 'IN_PROGRESS').map((task) => task.id),
        blocked: tasks
          .filter((task) => task.status === 'BLOCKED')
          .map((task) => ({ id: task.id, waiting_for: graph.isUnblocked(task).waiting_for })),
        open_questions: project.questions.filter((question) => !question.answer),
        critical_path: graph.criticalPath().path,
        progress: progressOf(tasks),
        cost_usd: Number(project.cost_totals_usd.toFixed(5)),
        tokens: project.tokens_total,
        plans: project.plans.length,
      };
    },

    doctor(): DoctorReport {
      const project = requireProject();
      const tasks = store.loadAllTasks();
      const graph = new WorkGraph(tasks);
      const validation = graph.validate();
      const stalled = tasks
        .filter((task) => task.status === 'IN_PROGRESS' && Date.now() - Date.parse(task.updated_at) > 30 * 60_000)
        .map((task) => task.id);
      // A plan that was generated and never applied cost real tokens and
      // produced nothing. Report it as a warning so it gets resolved.
      const unapplied = project.plans.filter((entry) => !entry.applied);
      const warnings = [
        ...validation.warnings,
        ...unapplied.map(
          (entry) =>
            `${entry.id} (${entry.author}, ${entry.scope}) was never applied — apply it or drop it deliberately`,
        ),
      ];

      return {
        ok: validation.ok,
        errors: validation.errors,
        warnings,
        task_count: tasks.length,
        file_overlaps: graph.fileOverlaps(),
        tasks_without_acceptance_criteria: tasks
          .filter((task) => !task.acceptance_criteria.length)
          .map((task) => task.id),
        stalled,
      };
    },

    configView(): ConfigView {
      const cfg = config();
      return {
        source: sourcesCache.length ? sourcesCache : ['defaults'],
        models: [
          {
            role: 'orchestrator',
            model: '',
            configurable: false,
            description: ROLE_DESCRIPTIONS.orchestrator,
          },
          ...CONFIGURABLE_ROLES.map((role) => ({
            role: role as Role,
            model: cfg.models[role],
            configurable: true,
            description: ROLE_DESCRIPTIONS[role],
          })),
        ],
        execution: cfg.execution,
        desktop: cfg.desktop,
        limits: cfg.limits,
      };
    },

    setModel(role, model) {
      const result = setRoleModel(projectDir, role, model);
      configCache = null;
      log('PROJECT_UPDATED', 'human', `model for ${role} set to ${model || '(chat model)'}`, undefined, { role, model });
      store.flush();
      return { role, model: model || '', written_to: result.path };
    },

    events(limit = 50) {
      return store.readEvents(limit);
    },

    async runtime(): Promise<RuntimeView> {
      return runtimeView(projectDir, host, { ...(setupRequest ? { setupRequest } : {}) });
    },

    requestSetup(): void {
      setupRequest?.raise();
    },

    async setup(input: SetupInput): Promise<SetupOutcome> {
      const outcome = await applySetup(projectDir, input, host, {
        ...(setupRequest ? { setupRequest } : {}),
      });
      configCache = null;
      if (store.exists()) {
        log('PROJECT_UPDATED', 'human', `setup: ${outcome.preset ?? input.choice}`, undefined, {
          builders: outcome.builders,
          models: outcome.models,
        });
        store.flush();
      }
      return outcome;
    },

    /**
     * Runs one role and returns its answer.
     *
     * The packet is built here and sent straight to the role, so it never
     * passes through the orchestrator's own context — which is what stops the
     * same text being paid for twice and keeps the wording exact.
     */
    async delegateRole(input) {
      const project = requireProject();
      const tasks = store.loadAllTasks();
      const task = input.taskId ? tasks.find((entry) => entry.id === input.taskId) : undefined;
      if (input.taskId && !task) throw new Error(`Unknown task ${input.taskId}`);

      const outcome = await delegate(
        {
          role: input.role,
          sessionID: input.sessionID,
          directory: input.directory,
          config: config(),
          project,
          tasks,
          ...(task ? { task } : {}),
          ...(input.brief ? { brief: input.brief } : {}),
          ...(input.signal ? { signal: input.signal } : {}),
        },
        host,
      );

      log(
        outcome.ok ? 'TASK_UPDATED' : 'TASK_FAILED',
        input.role,
        `${input.role} ${outcome.ok ? 'answered' : 'failed'}${task ? ` for ${task.id}` : ''}`,
        task?.id,
        { model: outcome.model, tokens: outcome.estimated_tokens },
      );
      store.flush();

      return {
        role: outcome.role,
        ok: outcome.ok,
        answer: outcome.text,
        model: outcome.model ?? '(chat model)',
        estimated_tokens: outcome.estimated_tokens,
        ...(outcome.truncated ? { context_truncated: true } : {}),
        ...(outcome.sessionID ? { session: outcome.sessionID } : {}),
        ...(outcome.error ? { error: outcome.error } : {}),
      };
    },

    /**
     * Starts every task the scheduler says may run, dispatches them to builders
     * concurrently, and records each outcome.
     *
     * This is the whole execution step in one call. Doing it in code rather
     * than as a chat loop is what makes the parallelism real, the packets
     * exact, and the token cost proportional to the work instead of to the
     * number of turns spent describing it.
     */
    async executeReady(input) {
      const project = requireProject();
      requireExecutable(project);
      const cfg = config();
      const decision = computeSchedule(store.loadAllTasks(), {
        maxParallel: cfg.execution.max_parallel,
        allowFileOverlap: cfg.execution.allow_file_overlap,
      });

      if (!decision.started.length) {
        return {
          started: [],
          results: [],
          ready: decision.ready,
          deferred: decision.deferred,
          running: decision.running,
          limit: decision.limit,
          next: decision.deferred.length
            ? 'Nothing can start yet. Resolve what the deferred entries are waiting on.'
            : 'Nothing is ready to run.',
        };
      }

      // Mark them running first, so the board is honest while work is in flight.
      const running: Task[] = [];
      for (const id of decision.started) {
        const task = store.loadTask(id);
        if (!task) continue;
        task.status = 'IN_PROGRESS';
        task.blocked_reason = undefined;
        store.saveTask(task);
        log('TASK_STARTED', 'orchestrator', `${id} dispatched to builder`, id);
        running.push(task);
      }
      store.flush();

      const tasks = store.loadAllTasks();
      const outcomes = await delegateMany(
        running.map((task) => ({
          role: 'builder' as ConfigurableRole,
          sessionID: input.sessionID,
          directory: input.directory,
          config: cfg,
          project,
          tasks,
          task,
          ...(input.signal ? { signal: input.signal } : {}),
        })),
        host,
        cfg.execution.max_parallel,
      );

      const results = outcomes.map((outcome, index) => {
        const task = running[index]!;
        if (!outcome.ok) {
          engine.taskFail(task.id, outcome.error ?? 'builder returned nothing', 'builder');
        }
        return {
          task: task.id,
          ok: outcome.ok,
          answer: outcome.text,
          model: outcome.model ?? '(chat model)',
          estimated_tokens: outcome.estimated_tokens,
          ...(outcome.error ? { error: outcome.error } : {}),
        };
      });

      return {
        started: decision.started,
        results,
        running: decision.running,
        limit: decision.limit,
        next:
          'For each successful result, record evidence with foundry_complete, then run its review gates.',
      };
    },
  };

  return engine;
}

export type { PlanProposal, TaskStatus };
