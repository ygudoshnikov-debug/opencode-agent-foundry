import { useEffect, useState } from 'react';
import type { UpdateTaskRequest, TaskStatus } from '@foundry/protocol';
import { api } from '@/services/api';
import type { TaskDetailResponse } from '@/services/api';
import StatusPill from './StatusPill';
import LoadingSkeleton from './LoadingSkeleton';
import { STATUS_LABELS } from '@/types/status';

interface TaskDetailPanelProps {
  task: TaskDetailResponse | null;
  loading?: boolean;
  onClose: () => void;
  onTaskUpdated?: () => void;
}

const STATUS_OPTIONS: TaskStatus[] = [
  'BACKLOG',
  'PLANNED',
  'READY',
  'IN_PROGRESS',
  'REVIEW',
  'BLOCKED',
  'FAILED',
  'DONE',
  'CANCELLED',
];

export default function TaskDetailPanel({
  task,
  loading = false,
  onClose,
  onTaskUpdated,
}: TaskDetailPanelProps) {
  const [statusUpdating, setStatusUpdating] = useState(false);

  const handleStatusChange = async (newStatus: TaskStatus) => {
    if (!task) return;

    setStatusUpdating(true);
    try {
      const update: UpdateTaskRequest = { status: newStatus };
      await api.updateTask(task.id, update);
      onTaskUpdated?.();
    } catch (error) {
      console.error('Failed to update task status:', error);
    } finally {
      setStatusUpdating(false);
    }
  };

  // Close on Escape.
  //
  // This must be useEffect, not useState: useState treats the function as a
  // lazy initialiser, so the listener would be attached during render — a side
  // effect in the render phase — and the returned cleanup would be stored as
  // state and thrown away, leaking a listener on every mount.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <dialog className="modal modal-open">
      <div className="modal-box w-full max-w-2xl max-h-96 overflow-y-auto">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="font-mono text-sm font-semibold text-base-content/60">{task?.id || 'Loading...'}</h2>
            {task && <p className="text-lg font-bold text-base-content mt-1">{task.title}</p>}
          </div>
          <button
            className="btn btn-sm btn-circle btn-ghost"
            onClick={onClose}
            aria-label="Close panel"
          >
            ✕
          </button>
        </div>

        <div className="space-y-6">
          {loading || !task ? (
            <LoadingSkeleton count={5} variant="card" />
          ) : (
            <>
              {/* Status Section */}
              <div>
                <h3 className="text-sm font-semibold text-base-content mb-2">Status</h3>
                <select
                  className="select select-sm"
                  value={task.status}
                  onChange={(e) => handleStatusChange(e.target.value as TaskStatus)}
                  disabled={statusUpdating}
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
              </div>

              {/* Objective Section */}
              {task.objective && (
                <div>
                  <h3 className="text-sm font-semibold text-base-content mb-2">Objective</h3>
                  <p className="text-sm text-base-content/80">{task.objective}</p>
                </div>
              )}

              {/* Metadata Section */}
              <div>
                <h3 className="text-sm font-semibold text-base-content mb-3">Details</h3>
                <div className="space-y-2">
                  {task.owner && (
                    <div className="flex justify-between">
                      <span className="text-sm text-base-content/70">Owner</span>
                      <span className="text-sm font-medium text-base-content">{task.owner}</span>
                    </div>
                  )}
                  {task.executor && (
                    <div className="flex justify-between">
                      <span className="text-sm text-base-content/70">Executor</span>
                      <span className="text-sm font-medium text-base-content">{task.executor}</span>
                    </div>
                  )}
                  {task.module && (
                    <div className="flex justify-between">
                      <span className="text-sm text-base-content/70">Module</span>
                      <span className="text-sm font-medium text-base-content">{task.module}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-sm text-base-content/70">Priority</span>
                    <span className="text-sm font-medium text-base-content">{task.priority}/9</span>
                  </div>
                </div>
              </div>

              {/* Acceptance Criteria */}
              {task.acceptance_criteria && task.acceptance_criteria.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-base-content mb-2">Acceptance Criteria</h3>
                  <ul className="list-disc list-inside space-y-1">
                    {task.acceptance_criteria.map((criterion: string, i: number) => (
                      <li key={i} className="text-sm text-base-content/80">{criterion}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Dependencies */}
              {task.depends_on && task.depends_on.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-base-content mb-2">Dependencies</h3>
                  <div className="flex flex-wrap gap-2">
                    {task.depends_on.map((dep: string) => (
                      <span key={dep} className="badge badge-sm badge-primary">
                        {dep}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Blocked By */}
              {task.blocked_by && task.blocked_by.length > 0 && (
                <div role="alert" className="alert alert-error">
                  <div>
                    <h3 className="font-semibold">Blocked By</h3>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {task.blocked_by.map((blocker: string) => (
                        <span key={blocker} className="badge badge-sm badge-error">
                          {blocker}
                        </span>
                      ))}
                    </div>
                    {task.blocked_reason && (
                      <p className="text-sm mt-2">{task.blocked_reason}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Error Summary */}
              {task.error_summary && (
                <div role="alert" className="alert alert-error">
                  <div>
                    <h3 className="font-semibold">Error</h3>
                    <p className="text-sm">{task.error_summary}</p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button onClick={onClose}>close</button>
      </form>
    </dialog>
  );
}
