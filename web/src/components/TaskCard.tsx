import type { TaskSummary } from '@foundry/protocol';
import StatusPill from './StatusPill';

interface TaskCardProps {
  task: TaskSummary;
  onClick?: () => void;
}

export default function TaskCard({ task, onClick }: TaskCardProps) {
  const isBlocked = task.blocked_by && task.blocked_by.length > 0;

  return (
    <div
      className="card bg-base-100 border border-base-300 cursor-pointer transition-all hover:border-primary hover:shadow-md hover:-translate-y-0.5"
      onClick={onClick}
      role="button"
      tabIndex={0}
    >
      <div className="card-body gap-3 p-4">
        <div className="flex justify-between items-start gap-2">
          <span className="font-mono text-xs font-semibold text-base-content/60 bg-base-200 px-2 py-1 rounded truncate shrink-0 max-w-[100px]">
            {task.id}
          </span>
          <StatusPill status={task.status} />
        </div>

        <div className="text-sm font-semibold text-base-content line-clamp-2">
          {task.title}
        </div>

        <div className="flex flex-wrap gap-2">
          {task.owner && <span className="badge badge-sm badge-primary">{task.owner}</span>}
          {task.executor && task.executor !== task.owner && (
            <span className="badge badge-sm badge-accent">{task.executor}</span>
          )}
          {task.module && <span className="badge badge-sm badge-ghost">{task.module}</span>}
        </div>

        <div className="flex flex-wrap gap-2">
          {task.attempts > 0 && (
            <span className="badge badge-sm badge-warning" title="Attempts">
              {task.attempts}x
            </span>
          )}

          {task.depends_on && task.depends_on.length > 0 && (
            <span className="badge badge-sm badge-primary" title="Dependencies">
              ← {task.depends_on.length}
            </span>
          )}

          {isBlocked && (
            <span className="badge badge-sm badge-error" title="Blocked by">
              ⊗ {task.blocked_by.length}
            </span>
          )}

          {task.blast_radius > 0 && (
            <span className="badge badge-sm badge-accent" title="Blast radius">
              ◆ {task.blast_radius}
            </span>
          )}
        </div>

        {isBlocked && (
          <div role="alert" className="alert alert-error mt-2 py-2 text-xs">
            <strong>Blocked by:</strong> {task.blocked_by.join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}
