import { SATISFIED_STATUSES, type GraphEdge, type Task } from './types.js';

/**
 * Deterministic Work Graph.
 *
 * Every scheduling, blocking and impact decision derives from structured edges,
 * never from free text. The reverse-dependency index is built once per instance
 * so downstream/blast-radius queries over the whole board stay linear rather
 * than re-walking the task list per node.
 */
export class WorkGraph {
  readonly tasks: Map<string, Task>;
  /** dependency id -> tasks that depend on it. */
  private readonly dependents: Map<string, string[]>;

  constructor(tasks: readonly Task[]) {
    this.tasks = new Map(tasks.map((task) => [task.id, task]));
    this.dependents = new Map();
    for (const task of this.tasks.values()) {
      for (const dep of task.depends_on) {
        const list = this.dependents.get(dep);
        if (list) list.push(task.id);
        else this.dependents.set(dep, [task.id]);
      }
    }
  }

  edges(): GraphEdge[] {
    const out: GraphEdge[] = [];
    for (const task of this.tasks.values()) {
      for (const dep of task.depends_on) out.push({ from: task.id, to: dep, kind: 'depends_on' });
      for (const blocked of task.blocks) out.push({ from: task.id, to: blocked, kind: 'blocks' });
      for (const related of task.related_to) out.push({ from: task.id, to: related, kind: 'related_to' });
      for (const child of task.child_tasks) out.push({ from: task.id, to: child, kind: 'parent_of' });
    }
    return out;
  }

  /** Transitive dependencies of `id` (things it waits on). */
  upstream(id: string): string[] {
    return this.walk(id, (current) => this.tasks.get(current)?.depends_on ?? []);
  }

  /** Transitive dependents of `id` (things waiting on it). */
  downstream(id: string): string[] {
    return this.walk(id, (current) => this.dependents.get(current) ?? []);
  }

  private walk(start: string, next: (id: string) => readonly string[]): string[] {
    const seen = new Set<string>();
    const stack = [...next(start)];
    while (stack.length) {
      const current = stack.pop()!;
      if (current === start || seen.has(current)) continue;
      seen.add(current);
      stack.push(...next(current));
    }
    return [...seen].sort();
  }

  /** Size of the downstream closure. Drives the extra review gates. */
  blastRadius(id: string): number {
    return this.downstream(id).length;
  }

  impact(id: string): {
    upstream: string[];
    downstream: string[];
    blast_radius: number;
    files: string[];
  } {
    const downstream = this.downstream(id);
    return {
      upstream: this.upstream(id),
      downstream,
      blast_radius: downstream.length,
      files: this.tasks.get(id)?.allowed_files ?? [],
    };
  }

  /** depends_on entries pointing at ids that do not exist. */
  missingDeps(): Array<{ task: string; missing: string }> {
    const out: Array<{ task: string; missing: string }> = [];
    for (const task of this.tasks.values()) {
      for (const dep of task.depends_on) {
        if (!this.tasks.has(dep)) out.push({ task: task.id, missing: dep });
      }
    }
    return out;
  }

  /** Cycles in depends_on. The execution graph must be acyclic. */
  detectCycles(): string[][] {
    const cycles: string[][] = [];
    const state = new Map<string, 0 | 1 | 2>();
    const stack: string[] = [];
    const visit = (id: string): void => {
      state.set(id, 1);
      stack.push(id);
      for (const dep of this.tasks.get(id)?.depends_on ?? []) {
        if (!this.tasks.has(dep)) continue;
        const seen = state.get(dep) ?? 0;
        if (seen === 1) cycles.push([...stack.slice(stack.indexOf(dep)), dep]);
        else if (seen === 0) visit(dep);
      }
      stack.pop();
      state.set(id, 2);
    };
    for (const id of this.tasks.keys()) if ((state.get(id) ?? 0) === 0) visit(id);
    return cycles;
  }

  /** A task is unblocked when every dependency is satisfied. */
  isUnblocked(task: Task): { ok: boolean; waiting_for: string[] } {
    const waiting = task.depends_on.filter((dep) => {
      const upstream = this.tasks.get(dep);
      // A dangling dependency blocks: silently ignoring it would run work early.
      return !upstream || !SATISFIED_STATUSES.has(upstream.status);
    });
    return { ok: waiting.length === 0, waiting_for: waiting };
  }

  /** Kahn order, dependencies first. `cyclic` lists nodes never emitted. */
  topoOrder(): { order: string[]; cyclic: string[] } {
    const indegree = new Map<string, number>();
    for (const id of this.tasks.keys()) indegree.set(id, 0);
    for (const task of this.tasks.values()) {
      for (const dep of task.depends_on) {
        if (this.tasks.has(dep)) indegree.set(task.id, (indegree.get(task.id) ?? 0) + 1);
      }
    }
    const queue = [...indegree.entries()].filter(([, n]) => n === 0).map(([id]) => id).sort();
    const order: string[] = [];
    while (queue.length) {
      const current = queue.shift()!;
      order.push(current);
      for (const dependent of this.dependents.get(current) ?? []) {
        const left = (indegree.get(dependent) ?? 0) - 1;
        indegree.set(dependent, left);
        if (left === 0) queue.push(dependent);
      }
    }
    const cyclic = [...indegree.entries()].filter(([, n]) => n > 0).map(([id]) => id);
    return { order, cyclic };
  }

  /** Longest dependency chain. Used to prioritise and to show the user. */
  criticalPath(): { path: string[]; length: number } {
    const { order } = this.topoOrder();
    const distance = new Map<string, number>();
    const previous = new Map<string, string | null>();
    for (const id of order) {
      let best = 0;
      let bestPrev: string | null = null;
      for (const dep of this.tasks.get(id)?.depends_on ?? []) {
        const candidate = (distance.get(dep) ?? 0) + 1;
        if (candidate > best) {
          best = candidate;
          bestPrev = dep;
        }
      }
      distance.set(id, best);
      previous.set(id, bestPrev);
    }
    let end: string | null = null;
    let max = -1;
    for (const [id, value] of distance) {
      if (value > max) {
        max = value;
        end = id;
      }
    }
    if (end === null) return { path: [], length: 0 };
    const path: string[] = [];
    let cursor: string | null = end;
    while (cursor) {
      path.unshift(cursor);
      cursor = previous.get(cursor) ?? null;
    }
    return { path, length: path.length };
  }

  /**
   * Pairs of *independent* tasks that declare the same file. These are the
   * pairs the scheduler must serialise; surfacing them at plan time is much
   * cheaper than discovering them as runtime lock conflicts.
   */
  fileOverlaps(): Array<{ a: string; b: string; files: string[] }> {
    const out: Array<{ a: string; b: string; files: string[] }> = [];
    const all = [...this.tasks.values()];
    for (let i = 0; i < all.length; i += 1) {
      for (let j = i + 1; j < all.length; j += 1) {
        const a = all[i]!;
        const b = all[j]!;
        if (!a.allowed_files.length || !b.allowed_files.length) continue;
        // Ordered pairs are fine: the scheduler runs them in sequence anyway.
        if (this.upstream(a.id).includes(b.id) || this.upstream(b.id).includes(a.id)) continue;
        const bFiles = new Set(b.allowed_files);
        const shared = a.allowed_files.filter((file) => bFiles.has(file));
        if (shared.length) out.push({ a: a.id, b: b.id, files: shared });
      }
    }
    return out;
  }

  validate(): { ok: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    for (const missing of this.missingDeps()) {
      errors.push(`${missing.task} depends on unknown task ${missing.missing}`);
    }
    for (const cycle of this.detectCycles()) {
      errors.push(`Dependency cycle: ${cycle.join(' -> ')}`);
    }
    for (const task of this.tasks.values()) {
      if (!task.title.trim()) errors.push(`${task.id} has an empty title`);
      if (task.depends_on.includes(task.id)) errors.push(`${task.id} depends on itself`);
      if (!task.acceptance_criteria.length) warnings.push(`${task.id} has no acceptance criteria`);
      if (task.status === 'BLOCKED' && !task.blocked_reason) {
        warnings.push(`${task.id} is BLOCKED without a reason`);
      }
      if (!task.allowed_files.length && task.executor === 'builder') {
        warnings.push(`${task.id} has no allowed_files, so its executor has unbounded scope`);
      }
    }
    for (const overlap of this.fileOverlaps()) {
      warnings.push(
        `${overlap.a} and ${overlap.b} both claim ${overlap.files.join(', ')} and are independent — they will be serialised`,
      );
    }
    return { ok: errors.length === 0, errors, warnings };
  }
}
