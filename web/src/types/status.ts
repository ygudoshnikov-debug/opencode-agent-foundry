import type { TaskStatus } from '@foundry/protocol';

/**
 * The single place a Kanban status becomes human-readable text.
 *
 * This lived in two components, which is exactly the kind of duplication that
 * drifts: rename a column in one and the board header and the task pill start
 * disagreeing. Add a status to the protocol and TypeScript will fail here until
 * it is given a label.
 */
export const STATUS_LABELS: Readonly<Record<TaskStatus, string>> = {
  BACKLOG: 'Backlog',
  PLANNED: 'Planned',
  READY: 'Ready',
  IN_PROGRESS: 'In Progress',
  REVIEW: 'Review',
  BLOCKED: 'Blocked',
  FAILED: 'Failed',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
};

/**
 * Short form for tight spaces. Deliberately not `label[0]`: "Ready" and
 * "Review" would both collapse to "R".
 */
export const STATUS_ABBREVIATIONS: Readonly<Record<TaskStatus, string>> = {
  BACKLOG: 'BKL',
  PLANNED: 'PLN',
  READY: 'RDY',
  IN_PROGRESS: 'WIP',
  REVIEW: 'REV',
  BLOCKED: 'BLK',
  FAILED: 'FAIL',
  DONE: 'DONE',
  CANCELLED: 'CNCL',
};

export function statusLabel(status: TaskStatus): string {
  return STATUS_LABELS[status] ?? status;
}
