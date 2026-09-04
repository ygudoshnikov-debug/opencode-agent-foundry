import type { FoundryConfig } from '../config/schema.js';
import type { WorkGraph } from '../core/graph.js';
import type { ConfigurableRole, ProjectState, Task } from '../core/types.js';

/**
 * Context packets.
 *
 * Cost is dominated by what we put in front of a model, not by which model we
 * pick. Each role gets progressively less: the architect sees the project, the
 * builder sees one task. Nobody ever receives the whole repository, and nobody
 * receives the whole project file — that inline blob was, measurably, the
 * largest single source of wasted tokens in the previous design.
 */

/** Rough chars-per-token. Good enough for budgeting. */
const CHARS_PER_TOKEN = 4;

export interface PacketInput {
  project: ProjectState;
  task?: Task;
  graph: WorkGraph;
  role: ConfigurableRole;
  config: FoundryConfig;
  /** Extra role-specific notes the orchestrator wants to pass down. */
  notes?: string[];
}

export interface Packet {
  role: ConfigurableRole;
  text: string;
  estimated_tokens: number;
  truncated: boolean;
}

function budgetFor(config: FoundryConfig, role: ConfigurableRole): number {
  return config.context[role];
}

/** Trims to the budget on a line boundary and says so, rather than silently. */
function fit(sections: string[], budgetTokens: number): { text: string; truncated: boolean } {
  const full = sections.join('\n');
  const limit = budgetTokens * CHARS_PER_TOKEN;
  if (full.length <= limit) return { text: full, truncated: false };
  const kept: string[] = [];
  let used = 0;
  for (const line of full.split('\n')) {
    if (used + line.length + 1 > limit) break;
    kept.push(line);
    used += line.length + 1;
  }
  kept.push('', `_[context trimmed to the ${budgetTokens} token budget for this role]_`);
  return { text: kept.join('\n'), truncated: true };
}

function bullets(items: readonly string[], limit: number): string[] {
  const shown = items.slice(0, limit).map((item) => `- ${item}`);
  if (items.length > limit) shown.push(`- …and ${items.length - limit} more`);
  return shown;
}

/**
 * Builds the packet for one role. The `builder` variant is the hot path: it is
 * sent once per execution attempt, so it carries the task and nothing else.
 */
export function buildPacket(input: PacketInput): Packet {
  const { project, task, graph, role, config } = input;
  const budget = budgetFor(config, role);
  const sections: string[] = [];

  if (role === 'builder') {
    if (!task) throw new Error('builder packet requires a task');
    sections.push(
      `# ${task.id} — ${task.title}`,
      '',
      '## Objective',
      task.objective,
      '',
      '## Scope — you may touch ONLY these paths',
      ...(task.allowed_files.length ? bullets(task.allowed_files, 40) : ['- (none declared — ask before writing)']),
      '',
      '## Acceptance criteria',
      ...(task.acceptance_criteria.length
        ? task.acceptance_criteria.map((criterion) => `- [ ] ${criterion}`)
        : ['- [ ] (none declared — ask before finishing)']),
    );
    if (task.verification) sections.push('', '## Verification command', '```', task.verification, '```');
    if (task.anchors.length) {
      sections.push('', '## Anchors — never change these', ...bullets(task.anchors, 10));
    }
    const lastFailure = [...task.history].reverse().find((attempt) => attempt.result === 'failure');
    if (lastFailure) {
      sections.push(
        '',
        `## Previous attempt (${task.attempts} so far) failed`,
        lastFailure.error_summary ?? 'no summary recorded',
        'Fix the cause. Do not repeat the same approach.',
      );
    }
    sections.push('', 'Report evidence: files touched, commands run, tests run and their result.');
  } else {
    sections.push(`# Project objective`, project.objective);

    const decided = project.questions.filter((question) => question.answer);
    if (decided.length) {
      sections.push(
        '',
        '## Answers from the human',
        ...decided.slice(0, 12).map((question) => `- ${question.question} → ${question.answer}`),
      );
    }
    if (project.human_decisions.length) {
      sections.push('', '## Human decisions (binding)', ...bullets(project.human_decisions, 10));
    }
    if (project.acceptance_anchors.length) {
      sections.push('', '## Acceptance anchors', ...bullets(project.acceptance_anchors, 10));
    }

    const tasks = [...graph.tasks.values()];
    const scoped =
      role === 'architect'
        ? tasks
        : tasks.filter((candidate) =>
            role === 'lead'
              ? candidate.module === task?.module
              : candidate.functionality === task?.functionality,
          );

    if (scoped.length) {
      const counts: Record<string, number> = {};
      for (const item of scoped) counts[item.status] = (counts[item.status] ?? 0) + 1;
      sections.push(
        '',
        `## Board in scope (${scoped.length} tasks)`,
        Object.entries(counts)
          .map(([status, count]) => `${status} ${count}`)
          .join(' · '),
      );
      const notable = scoped
        .filter((item) => item.status === 'BLOCKED' || item.status === 'FAILED' || item.status === 'REVIEW')
        .slice(0, 15);
      if (notable.length) {
        sections.push(
          '',
          '## Needs attention',
          ...notable.map(
            (item) => `- ${item.id} [${item.status}] ${item.title}${item.blocked_reason ? ` — ${item.blocked_reason}` : ''}`,
          ),
        );
      }
    }

    if (task) {
      sections.push(
        '',
        `## Focus: ${task.id} — ${task.title}`,
        task.objective,
        ...(task.allowed_files.length ? ['', '### Files', ...bullets(task.allowed_files, 20)] : []),
      );
      const downstream = graph.downstream(task.id);
      if (downstream.length) {
        sections.push('', `### Blast radius: ${downstream.length}`, ...bullets(downstream, 12));
      }
    }
  }

  if (input.notes?.length) sections.push('', '## Notes', ...bullets(input.notes, 10));

  const { text, truncated } = fit(sections, budget);
  return { role, text, estimated_tokens: Math.ceil(text.length / CHARS_PER_TOKEN), truncated };
}
