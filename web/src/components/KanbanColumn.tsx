import type { TaskSummary, TaskStatus } from '@foundry/protocol';
import TaskCard from './TaskCard';
import EmptyState from './EmptyState';
import { STATUS_LABELS } from '@/types/status';

interface KanbanColumnProps {
  status: TaskStatus;
  tasks: TaskSummary[];
  collapsed?: boolean;
  onCollapse?: (status: TaskStatus) => void;
  onTaskClick?: (task: TaskSummary) => void;
}

export default function KanbanColumn({
  status,
  tasks,
  collapsed = false,
  onCollapse,
  onTaskClick,
}: KanbanColumnProps) {
  // An empty column collapses to a rail so nine columns do not push the ones
  // that actually hold work off-screen. The label is written vertically rather
  // than reduced to an initial: "Ready" and "Review" would both become "R".
  if (collapsed && tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-start min-h-96">
        <button
          type="button"
          className="btn btn-sm btn-ghost [writing-mode:vertical-rl] rotate-180 text-xs py-4 px-1 h-auto font-semibold text-base-content/70 hover:text-base-content"
          onClick={() => onCollapse?.(status)}
          title={`Show the empty ${STATUS_LABELS[status]} column`}
          aria-label={`Show the empty ${STATUS_LABELS[status]} column`}
          style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
        >
          {STATUS_LABELS[status]}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 min-w-80 min-h-96">
      <div className="flex items-center justify-between gap-2 px-1">
        <h3 className="font-bold text-base text-base-content">
          {STATUS_LABELS[status]} <span className="badge badge-sm badge-ghost">{tasks.length}</span>
        </h3>
        {tasks.length === 0 && (
          <button
            className="btn btn-xs btn-ghost"
            onClick={() => onCollapse?.(status)}
            title="Collapse empty column"
            aria-label="Collapse column"
          >
            −
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto pr-2">
        {tasks.length === 0 ? (
          <EmptyState
            title={`No ${STATUS_LABELS[status].toLowerCase()} tasks`}
            description="Tasks will appear here as they progress"
          />
        ) : (
          <div className="space-y-3">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onClick={() => onTaskClick?.(task)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
