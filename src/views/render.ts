import type { GraphEdge } from '../core/types.js';
import type { DoctorReport, ProjectSummary } from '../desktop/protocol.js';

export { renderBoardMarkdown, renderTree } from '../core/board.js';

/** Terminal-friendly project summary. Mirrors what the desktop Dashboard shows. */
export function renderStatusMarkdown(status: ProjectSummary): string {
  if (!status.initialized) {
    return ['# Agent Foundry', '', status.hint ?? 'Not initialised in this directory.'].join('\n');
  }
  const counts = Object.entries(status.totals.by_status)
    .filter(([, count]) => count > 0)
    .map(([name, count]) => `${name} ${count}`)
    .join(' · ');

  const lines = [
    '# Agent Foundry — Status',
    '',
    `> ${status.objective ?? ''}`,
    '',
    `- Phase: **${status.phase}** · ${status.progress.done}/${status.progress.total} done (${status.progress.percent}%)`,
    `- Tasks: ${status.totals.tasks}${counts ? ` — ${counts}` : ''}`,
    `- Running: ${status.running.join(', ') || '—'}`,
    `- Critical path: ${status.critical_path.join(' → ') || '—'}`,
    `- Estimated cost: $${status.cost_usd.toFixed(4)} · ~${status.tokens} tokens`,
  ];

  if (status.open_questions.length) {
    lines.push('', '## Waiting on you');
    for (const question of status.open_questions) lines.push(`- **${question.id}** ${question.question}`);
  }
  if (status.blocked.length) {
    lines.push('', '## Blocked');
    for (const item of status.blocked) {
      lines.push(`- **${item.id}** waiting on ${item.waiting_for.join(', ') || 'an external dependency'}`);
    }
  }
  return lines.join('\n');
}

export function renderDoctorMarkdown(report: DoctorReport): string {
  const lines = [`# Doctor — ${report.ok ? 'ok' : 'problems found'}`, '', `${report.task_count} tasks checked.`];
  if (report.errors.length) {
    lines.push('', '## Errors (fix before executing)');
    for (const error of report.errors) lines.push(`- ${error}`);
  }
  if (report.warnings.length) {
    lines.push('', '## Warnings');
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  }
  if (report.stalled.length) {
    lines.push('', `## Stalled: ${report.stalled.join(', ')}`);
  }
  if (!report.errors.length && !report.warnings.length) lines.push('', 'Nothing to report.');
  return lines.join('\n');
}

const EDGE_LIMIT = 80;

export function renderGraphAscii(edges: readonly GraphEdge[], focus?: string): string {
  const relevant = focus ? edges.filter((edge) => edge.from === focus || edge.to === focus) : edges.slice(0, EDGE_LIMIT);
  if (!relevant.length) return '# Work Graph\n\n_no edges_';
  const lines = ['# Work Graph', ''];
  for (const edge of relevant) lines.push(`${edge.from} --[${edge.kind}]--> ${edge.to}`);
  if (!focus && edges.length > EDGE_LIMIT) {
    lines.push('', `…and ${edges.length - EDGE_LIMIT} more edges. Query a specific task id to focus.`);
  }
  return lines.join('\n');
}
