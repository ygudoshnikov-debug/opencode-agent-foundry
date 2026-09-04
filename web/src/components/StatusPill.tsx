import type { TaskStatus } from '@foundry/protocol';
import { STATUS_ABBREVIATIONS, STATUS_LABELS } from '@/types/status';

interface StatusPillProps {
  status: TaskStatus;
  compact?: boolean;
}

const statusColorMap: Record<TaskStatus, string> = {
  BACKLOG: 'badge-ghost',
  PLANNED: 'badge-primary',
  READY: 'badge-success',
  IN_PROGRESS: 'badge-warning',
  REVIEW: 'badge-info',
  BLOCKED: 'badge-error',
  FAILED: 'badge-error',
  DONE: 'badge-success',
  CANCELLED: 'badge-ghost',
};

export default function StatusPill({ status, compact }: StatusPillProps) {
  const colorClass = statusColorMap[status] || 'badge-neutral';

  return (
    <span
      className={`badge badge-sm ${colorClass} uppercase tracking-wider`}
      title={STATUS_LABELS[status]}
    >
      {compact ? STATUS_ABBREVIATIONS[status] : STATUS_LABELS[status]}
    </span>
  );
}
