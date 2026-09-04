import { WorkGraph } from './graph.js';
import { KANBAN_COLUMNS, type Task, type TaskStatus } from './types.js';
import type { Board, TaskSummary } from '../desktop/protocol.js';

/**
 * The Kanban board.
 *
 * It is a *projection* of task state, not a second store — there is exactly one
 * source of truth (`tasks/`). Everything the orchestrator, the CLI and the
 * desktop UI show about progress is built here, so all three always agree.
 *
 * Summaries are deliberately small: this payload is returned to a language
 * model on every board read, and full task JSON was the single largest source
 * of wasted tokens in the previous design.
 */
export function summarize(task: Task, graph: WorkGraph): TaskSummary {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    owner: String(task.owner),
    executor: String(task.executor),
    ...(task.module ? { module: task.module } : {}),
    ...(task.functionality ? { functionality: task.functionality } : {}),
    attempts: task.attempts,
    depends_on: task.depends_on,
    blocked_by: graph.isUnblocked(task).waiting_for,
    blast_radius: graph.blastRadius(task.id),
    updated_at: task.updated_at,
  };
}

export function buildBoard(tasks: readonly Task[], graph = new WorkGraph(tasks)): Board {
  const byStatus: Record<string, number> = {};
  const columns = KANBAN_COLUMNS.map((status) => ({ status, task_ids: [] as string[] }));
  const index = new Map<TaskStatus, string[]>(columns.map((column) => [column.status, column.task_ids]));

  const summaries: TaskSummary[] = [];
  for (const task of tasks) {
    summaries.push(summarize(task, graph));
    byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;
    index.get(task.status)?.push(task.id);
  }

  // Highest priority first, then widest blast radius, then id for stability.
  const rank = new Map(summaries.map((summary) => [summary.id, summary]));
  for (const column of columns) {
    column.task_ids.sort((a, b) => {
      const left = rank.get(a)!;
      const right = rank.get(b)!;
      return right.priority - left.priority || right.blast_radius - left.blast_radius || a.localeCompare(b);
    });
  }

  return {
    generated_at: new Date().toISOString(),
    columns,
    tasks: summaries,
    totals: { tasks: tasks.length, by_status: byStatus },
  };
}

export function progressOf(tasks: readonly Task[]): { done: number; total: number; percent: number } {
  const total = tasks.filter((task) => task.status !== 'CANCELLED').length;
  const done = tasks.filter((task) => task.status === 'DONE').length;
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/** Compact markdown board for the CLI and for chat replies. */
export function renderBoardMarkdown(board: Board, objective?: string): string {
  const lines: string[] = ['# Agent Foundry — Board'];
  if (objective) lines.push('', `> ${objective}`);
  const summary = KANBAN_COLUMNS.map((status) => `${status} ${board.totals.by_status[status] ?? 0}`).join(' · ');
  lines.push('', `_${board.totals.tasks} tasks · ${summary}_`);

  const byId = new Map(board.tasks.map((task) => [task.id, task]));
  for (const column of board.columns) {
    if (!column.task_ids.length) continue;
    lines.push('', `## ${column.status} (${column.task_ids.length})`);
    for (const id of column.task_ids) {
      const task = byId.get(id);
      if (!task) continue;
      const blocked = task.blocked_by.length ? ` — waiting on ${task.blocked_by.join(', ')}` : '';
      const attempts = task.attempts > 0 ? ` ×${task.attempts}` : '';
      lines.push(`- **${id}** ${task.title} \`${task.executor}\`${attempts}${blocked}`);
    }
  }
  return lines.join('\n');
}

/** Module → functionality → task outline. */
export function renderTree(tasks: readonly Task[]): string {
  const byModule = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = task.module ?? 'GENERAL';
    const list = byModule.get(key);
    if (list) list.push(task);
    else byModule.set(key, [task]);
  }

  const icon = (status: TaskStatus): string => {
    if (status === 'DONE') return '[x]';
    if (status === 'CANCELLED') return '[-]';
    if (status === 'BLOCKED' || status === 'FAILED') return '[!]';
    if (status === 'IN_PROGRESS' || status === 'REVIEW') return '[~]';
    return '[ ]';
  };

  const lines = ['PROJECT'];
  for (const [moduleName, moduleTasks] of [...byModule.entries()].sort()) {
    lines.push(`├── ${moduleName} (${moduleTasks.length})`);
    const byFunctionality = new Map<string, Task[]>();
    for (const task of moduleTasks) {
      const key = task.functionality ?? '—';
      const list = byFunctionality.get(key);
      if (list) list.push(task);
      else byFunctionality.set(key, [task]);
    }
    for (const [functionality, items] of [...byFunctionality.entries()].sort()) {
      lines.push(`│   ├── ${functionality}`);
      for (const task of [...items].sort((a, b) => a.id.localeCompare(b.id))) {
        lines.push(`│   │   ├── ${icon(task.status)} ${task.id} ${task.title}`);
      }
    }
  }
  return lines.join('\n');
}
