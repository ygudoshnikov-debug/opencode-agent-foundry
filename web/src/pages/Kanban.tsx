import { useState, useRef, useEffect } from 'react';
import type { TaskSummary } from '@foundry/protocol';
import { api } from '@/services/api';
import type { TaskDetailResponse } from '@/services/api';
import { useFoundryStore } from '@/stores/foundry';
import KanbanColumn from '@/components/KanbanColumn';
import TaskDetailPanel from '@/components/TaskDetailPanel';
import LoadingSkeleton from '@/components/LoadingSkeleton';

export default function Kanban() {
  const { state } = useFoundryStore();
  const [filterText, setFilterText] = useState('');
  const [selectedTask, setSelectedTask] = useState<TaskSummary | null>(null);
  const [taskDetail, setTaskDetail] = useState<TaskDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // Empty columns start collapsed: nine full-width columns for a handful of
  // tasks pushes the interesting ones off-screen. A column that gains a task
  // expands on its own, and the rail stays clickable to force it open.
  const [expandedEmptyColumns, setExpandedEmptyColumns] = useState<Set<string>>(new Set());
  const filterInputRef = useRef<HTMLInputElement>(null);

  // Focus filter on "/" or via event
  const handleFocusFilter = () => {
    filterInputRef.current?.focus();
  };

  useEffect(() => {
    window.addEventListener('focusFilter', handleFocusFilter);
    return () => window.removeEventListener('focusFilter', handleFocusFilter);
  }, []);

  const handleTaskClick = async (task: TaskSummary) => {
    setSelectedTask(task);
    setDetailLoading(true);
    try {
      const detail = await api.task(task.id);
      setTaskDetail(detail as TaskDetailResponse);
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
    // Refresh the task detail
    if (selectedTask) {
      try {
        const detail = await api.task(selectedTask.id);
        setTaskDetail(detail as TaskDetailResponse);
      } catch (error) {
        console.error('Failed to refresh task detail:', error);
      }
    }
  };

  const toggleColumnCollapse = (status: string) => {
    const next = new Set(expandedEmptyColumns);
    if (next.has(status)) next.delete(status);
    else next.add(status);
    setExpandedEmptyColumns(next);
  };

  const filterTasks = (tasks: TaskSummary[]): TaskSummary[] => {
    if (!filterText) return tasks;
    const lower = filterText.toLowerCase();
    return tasks.filter(
      (task) =>
        task.id.toLowerCase().includes(lower) ||
        task.title.toLowerCase().includes(lower) ||
        task.module?.toLowerCase().includes(lower) ||
        task.owner?.toLowerCase().includes(lower),
    );
  };

  if (!state.board) {
    return (
      <div className="p-6">
        <LoadingSkeleton count={3} variant="card" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Kanban</h1>
        <input
          ref={filterInputRef}
          type="search"
          className="input input-sm w-full max-w-xs"
          aria-label="Filter tasks"
          placeholder="Filter tasks — press / to focus"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === '/') {
              e.preventDefault();
              setFilterText('');
            }
          }}
        />
      </header>

      <div className="flex flex-1 gap-3 overflow-x-auto pb-2">
        {state.board.columns.map((column) => {
          const columnTasks = filterTasks(
            state.board!.tasks.filter((t) => t.status === column.status),
          );
          const isCollapsed = columnTasks.length === 0 && !expandedEmptyColumns.has(column.status);

          return (
            <KanbanColumn
              key={column.status}
              status={column.status}
              tasks={columnTasks}
              collapsed={isCollapsed}
              onCollapse={() => toggleColumnCollapse(column.status)}
              onTaskClick={handleTaskClick}
            />
          );
        })}
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
