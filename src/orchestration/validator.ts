import type { WorkGraph } from '../core/graph.js';
import type { GateName, ReviewGate, Task, TaskEvidence } from '../core/types.js';

/**
 * Validation and review gates.
 *
 * An executor claiming success is not success. A task only leaves REVIEW when
 * evidence exists, tests actually ran and passed, and every required gate has
 * been signed off.
 */

export interface ValidationResult {
  ok: boolean;
  reasons: string[];
  required_gates: GateName[];
}

/**
 * Which gates a task needs. Wide blast radius or an anchor being touched pulls
 * in higher-level review; a leaf task with no dependents needs only the basics.
 */
export function requiredGatesFor(task: Task, downstreamCount: number, touchesContract: boolean): GateName[] {
  const gates: GateName[] = ['execution', 'test', 'review'];
  if (downstreamCount >= 3 || touchesContract) gates.push('architecture');
  if (downstreamCount >= 5 || task.anchors.length > 0) gates.push('acceptance');
  return gates;
}

/**
 * Reasons a completion claim is not acceptable.
 *
 * `tests_executed` must be non-empty AND `test_result` must be `pass`. Both are
 * required: a run that reports `pass` with no commands is an executor asserting
 * a result it never produced, which is exactly the failure mode this guards.
 */
export function validateCompletion(
  task: Task,
  evidence: TaskEvidence | undefined,
  graph: WorkGraph,
  options: { touchesContract?: boolean } = {},
): ValidationResult {
  const downstream = graph.downstream(task.id).length;
  const required = requiredGatesFor(task, downstream, options.touchesContract ?? false);

  if (!evidence) {
    return {
      ok: false,
      reasons: ['no evidence supplied — report files, commands and tests'],
      required_gates: required,
    };
  }

  const reasons: string[] = [];
  const touched = [
    ...(evidence.files_created ?? []),
    ...(evidence.files_modified ?? []),
    ...(evidence.files_deleted ?? []),
  ];
  if (touched.length === 0) reasons.push('no files created, modified or deleted');

  const tests = evidence.tests_executed ?? [];
  if (tests.length === 0) {
    reasons.push('no tests executed');
  } else if (evidence.test_result === 'fail') {
    reasons.push('tests failed');
  } else if (evidence.test_result !== 'pass') {
    reasons.push('test result not confirmed as pass');
  }

  // Scope violation: the executor edited files outside its declared territory.
  if (task.allowed_files.length) {
    const allowed = new Set(task.allowed_files);
    const strays = touched.filter((file) => !allowed.has(file) && !isCoveredByGlob(file, task.allowed_files));
    if (strays.length) reasons.push(`files outside allowed_files: ${strays.slice(0, 5).join(', ')}`);
  }

  return { ok: reasons.length === 0, reasons, required_gates: required };
}

/** Minimal glob support so `src/auth/**` in allowed_files behaves sensibly. */
function isCoveredByGlob(file: string, patterns: readonly string[]): boolean {
  const normalized = file.replace(/\\/g, '/');
  return patterns.some((pattern) => {
    const normalizedPattern = pattern.replace(/\\/g, '/');
    if (!normalizedPattern.includes('*')) return false;
    const regex = new RegExp(
      `^${normalizedPattern
        .split('**')
        .map((part) => part.split('*').map(escapeRegex).join('[^/]*'))
        .join('.*')}$`,
    );
    return regex.test(normalized);
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

export type FailureDecision = 'retry' | 'escalate' | 'block';

/**
 * What to do after a failed attempt. Retry while budget remains, then escalate
 * once, then block and surface it to the human. Never loop forever — repeated
 * cheap failures cost more than one escalation.
 */
export function decideOnFailure(task: Task, maxRetries: number): { decision: FailureDecision; reason: string } {
  if (task.attempts <= maxRetries) {
    return { decision: 'retry', reason: `attempt ${task.attempts} of ${maxRetries + 1}` };
  }
  if (!task.escalation) {
    return { decision: 'escalate', reason: `${task.attempts} attempts exhausted, escalate to the owner` };
  }
  return { decision: 'block', reason: 'attempts and escalation exhausted — human input required' };
}

export function gatesRemaining(task: Task): ReviewGate[] {
  return task.review_gates.filter((gate) => gate.status !== 'passed' && gate.status !== 'skipped');
}

/**
 * Anchors are immutable reference points: human decisions, frozen contracts and
 * acceptance criteria. An update that rewrites one is refused rather than
 * quietly applied, because a system can be internally consistent and still be
 * solving the wrong problem.
 */
export function anchorViolations(task: Task, patch: Partial<Task>): string[] {
  if (!task.anchors.length) return [];
  const violations: string[] = [];
  if (patch.acceptance_criteria) {
    const before = new Set(task.acceptance_criteria);
    const removed = task.acceptance_criteria.filter(
      (criterion) => task.anchors.includes(criterion) && !patch.acceptance_criteria!.includes(criterion),
    );
    if (removed.length) violations.push(`removes anchored acceptance criteria: ${removed.join('; ')}`);
    const rewritten = patch.acceptance_criteria.filter(
      (criterion) => !before.has(criterion) && task.anchors.includes(criterion),
    );
    if (rewritten.length) violations.push(`rewrites anchored criteria: ${rewritten.join('; ')}`);
  }
  if (patch.anchors && patch.anchors.length < task.anchors.length) {
    violations.push('removes anchors');
  }
  return violations;
}
