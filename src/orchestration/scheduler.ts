import { WorkGraph } from '../core/graph.js';
import { RUNNING_STATUSES, SCHEDULABLE_STATUSES, type SchedulerDecision, type Task } from '../core/types.js';

export interface ScheduleOptions {
  /**
   * How many builders may run at once. 0 means unlimited, in which case the
   * only things holding work back are dependencies and file locks.
   */
  maxParallel: number;
  /** When false, two tasks declaring the same file never run together. */
  allowFileOverlap: boolean;
}

/** Sentinel for "no ceiling", kept out of the arithmetic below. */
const UNLIMITED = Number.POSITIVE_INFINITY;

function overlaps(a: Task, b: Task): string[] {
  if (!a.allowed_files.length || !b.allowed_files.length) return [];
  const files = new Set(a.allowed_files);
  return b.allowed_files.filter((file) => files.has(file));
}

/**
 * The single execution flow.
 *
 * There are no execution modes. The scheduler always does the same thing:
 * take every task whose dependencies are satisfied, order it by priority then
 * by how much work it unblocks, and start as many as the parallelism ceiling
 * and the file locks allow.
 *
 * Pure function of task state — same input, same decision, always.
 */
export function computeSchedule(tasks: readonly Task[], options: ScheduleOptions): SchedulerDecision {
  const graph = new WorkGraph(tasks);
  const configured = Math.floor(options.maxParallel);
  const limit = configured <= 0 ? UNLIMITED : configured;
  const running = tasks.filter((task) => RUNNING_STATUSES.has(task.status));
  const slots = Math.max(0, limit - running.length);

  const deferred: Array<{ id: string; reason: string }> = [];
  const candidates: Task[] = [];

  for (const task of tasks) {
    if (!SCHEDULABLE_STATUSES.has(task.status)) continue;
    const gate = graph.isUnblocked(task);
    if (gate.ok) candidates.push(task);
    else deferred.push({ id: task.id, reason: `waiting for ${gate.waiting_for.join(', ')}` });
  }

  candidates.sort(
    (a, b) =>
      b.priority - a.priority ||
      graph.blastRadius(b.id) - graph.blastRadius(a.id) ||
      a.id.localeCompare(b.id),
  );

  const started: string[] = [];
  const claimed: Task[] = [...running];
  for (const task of candidates) {
    if (started.length >= slots) {
      deferred.push({ id: task.id, reason: `parallelism limit reached (${configured})` });
      continue;
    }
    if (!options.allowFileOverlap) {
      const conflict = claimed.find((other) => overlaps(other, task).length > 0);
      if (conflict) {
        deferred.push({ id: task.id, reason: `file lock held by ${conflict.id}` });
        continue;
      }
    }
    started.push(task.id);
    claimed.push(task);
  }

  return {
    ready: candidates.map((task) => task.id),
    started,
    deferred,
    running: running.length,
    // Report the configured value, not the sentinel: Infinity does not survive
    // JSON, and 0 is what every surface displays as "unlimited".
    limit: configured <= 0 ? 0 : configured,
  };
}

export function runningTaskIds(tasks: readonly Task[]): string[] {
  return tasks.filter((task) => RUNNING_STATUSES.has(task.status)).map((task) => task.id);
}
