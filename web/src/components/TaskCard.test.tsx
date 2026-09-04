import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TaskCard from './TaskCard';
import type { TaskSummary } from '@foundry/protocol';

const mockTask: TaskSummary = {
  id: 'task-1',
  title: 'Test Task',
  status: 'IN_PROGRESS',
  priority: 5,
  owner: 'architect',
  executor: 'builder',
  module: 'core',
  functionality: 'auth',
  attempts: 2,
  depends_on: ['task-0'],
  blocked_by: [],
  blast_radius: 3,
  updated_at: '2024-01-01T00:00:00Z',
};

const blockedTask: TaskSummary = {
  ...mockTask,
  id: 'task-blocked',
  title: 'Blocked Task',
  status: 'BLOCKED',
  blocked_by: ['task-1', 'task-2'],
};

describe('TaskCard', () => {
  it('should render task id, title and status', () => {
    render(<TaskCard task={mockTask} />);
    expect(screen.getByText('task-1')).toBeInTheDocument();
    expect(screen.getByText('Test Task')).toBeInTheDocument();
  });

  it('should render owner and executor', () => {
    render(<TaskCard task={mockTask} />);
    expect(screen.getByText('architect')).toBeInTheDocument();
    expect(screen.getByText('builder')).toBeInTheDocument();
  });

  it('should render module', () => {
    render(<TaskCard task={mockTask} />);
    expect(screen.getByText('core')).toBeInTheDocument();
  });

  it('should render attempts badge', () => {
    render(<TaskCard task={mockTask} />);
    expect(screen.getByText('2x')).toBeInTheDocument();
  });

  it('should render blocked indicator for blocked tasks', () => {
    render(<TaskCard task={blockedTask} />);
    expect(screen.getByText('Blocked by:')).toBeInTheDocument();
    expect(screen.getByText(/task-1, task-2/)).toBeInTheDocument();
  });

  it('should call onClick when clicked', () => {
    const onClick = vi.fn();
    render(<TaskCard task={mockTask} onClick={onClick} />);
    const card = screen.getByRole('button');
    card.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('should not render blocked indicator for unblocked tasks', () => {
    render(<TaskCard task={mockTask} />);
    expect(screen.queryByText('Blocked by:')).not.toBeInTheDocument();
  });
});
