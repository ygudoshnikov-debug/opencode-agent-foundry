import { useState } from 'react';
import type { TaskSummary } from '@foundry/protocol';
import { api } from '@/services/api';
import type { TaskDetailResponse } from '@/services/api';
import { useFoundryStore } from '@/stores/foundry';
import TaskDetailPanel from '@/components/TaskDetailPanel';
import StatusPill from '@/components/StatusPill';
import LoadingSkeleton from '@/components/LoadingSkeleton';

type SortKey =
  | 'id'
  | 'title'
  | 'status'
  | 'owner'
  | 'executor'
  | 'module'
  | 'attempts'
  | 'blast_radius'
  | 'updated_at';
type SortOrder = 'asc' | 'desc';

const COLUMNS: Array<{ key: SortKey; label: string; numeric?: boolean }> = [
  { key: 'id', label: 'ID' },
  { key: 'title', label: 'Title' },
  { key: 'status', label: 'Status' },
  { key: 'owner', label: 'Owner' },
  { key: 'executor', label: 'Executor' },
  { key: 'module', label: 'Module' },
  { key: 'attempts', label: 'Attempts', numeric: true },
  { key: 'blast_radius', label: 'Blast', numeric: true },
  { key: 'updated_at', label: 'Updated' },
];

export default function Tasks() {
  const { state } = useFoundryStore();
  const [sortKey, setSortKey] = useState<SortKey>('updated_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [selectedTask, setSelectedTask] = useState<TaskSummary | null>(null);
  const [taskDetail, setTaskDetail] = useState<TaskDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const openTask = async (task: TaskSummary) => {
    setSelectedTask(task);
    setDetailLoading(true);
    try {
      setTaskDetail((await api.task(task.id)) as TaskDetailResponse);
    } catch (error) {
      console.error('Failed to load task detail:', error);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCloseDetail = () => {
    setSelectedTask(null);
    setTaskDetail(null);
  };

  const handleTaskUpdated = async () => {
    if (!selectedTask) return;
    try {
      setTaskDetail((await api.task(selectedTask.id)) as TaskDetailResponse);
    } catch (error) {
      console.error('Failed to refresh task detail:', error);
    }
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      setSortOrder('asc');
    }
  };

  if (!state.board) {
    return (
      <div className="p-6">
        <LoadingSkeleton count={5} variant="row" />
      </div>
    );
  }

  // Undefined sorts last in both directions, so a missing module never displaces
  // a real one at the top of the table.
  const tasks = [...state.board.tasks].sort((a, b) => {
    const left = a[sortKey as keyof TaskSummary];
    const right = b[sortKey as keyof TaskSummary];
    if (left === right) return 0;
    if (left === undefined || left === '') return 1;
    if (right === undefined || right === '') return -1;
    const order = left < right ? -1 : 1;
    return sortOrder === 'asc' ? order : -order;
  });

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Tasks</h1>
        <p className="text-base-content/70 text-sm">{tasks.length} on the board</p>
      </header>

      <div className="rounded-box border-base-300 bg-base-100 max-w-full overflow-x-auto border">
        <table className="table table-sm table-pin-rows">
          <thead>
            <tr>
              {COLUMNS.map((column) => {
                const active = sortKey === column.key;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={column.numeric ? 'text-right' : undefined}
                    aria-sort={active ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    {/* A button, not a click handler on the th: sorting has to be
                        reachable by keyboard. */}
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs -mx-2 font-semibold"
                      onClick={() => handleSort(column.key)}
                    >
                      {column.label}
                      <span aria-hidden="true" className={active ? '' : 'opacity-0'}>
                        {sortOrder === 'asc' ? '↑' : '↓'}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr
                key={task.id}
                className={
                  selectedTask?.id === task.id
                    ? 'bg-base-200 hover:bg-base-200 cursor-pointer'
                    : 'hover:bg-base-200 cursor-pointer'
                }
                onClick={() => void openTask(task)}
              >
                <td>
                  {/* The row is clickable for the mouse; this button is the
                      keyboard and screen-reader path to the same detail panel. */}
                  <button
                    type="button"
                    className="link link-hover font-mono text-xs"
                    onClick={(event) => {
                      event.stopPropagation();
                      void openTask(task);
                    }}
                  >
                    {task.id}
                  </button>
                </td>
                <td className="max-w-xs truncate" title={task.title}>
                  {task.title}
                </td>
                <td>
                  <StatusPill status={task.status} compact />
                </td>
                <td className="text-base-content/70">{task.owner}</td>
                <td className="text-base-content/70">{task.executor}</td>
                <td className="text-base-content/70">{task.module || '—'}</td>
                <td className="text-right tabular-nums">{task.attempts}</td>
                <td className="text-right tabular-nums">{task.blast_radius}</td>
                <td className="text-base-content/70 whitespace-nowrap">
                  {new Date(task.updated_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedTask && (
        <TaskDetailPanel
          task={taskDetail}
          loading={detailLoading}
          onClose={handleCloseDetail}
          onTaskUpdated={handleTaskUpdated}
        />
      )}
    </div>
  );
}
