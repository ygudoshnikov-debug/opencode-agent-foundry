import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import TaskDetailPanel from './TaskDetailPanel';
import type { TaskDetailResponse } from '@/services/api';

const mockTask: TaskDetailResponse = {
  id: 'TASK-1',
  title: 'Test Task',
  status: 'PLANNED',
  objective: 'Test objective',
  owner: 'analyst',
  executor: 'builder',
  module: 'test-module',
  priority: 5,
  attempts: 0,
  allowed_files: ['src/thing.ts'],
  acceptance_criteria: ['Criterion 1'],
  verification: 'npm test',
  anchors: [],
  gates: ['execution:pending'],
  depends_on: [],
  blocked_by: [],
  blast_radius: 0,
  upstream: [],
  downstream: [],
  updated_at: '2026-01-01T00:00:00.000Z',
};

type SpiedListener = { mock: { calls: unknown[][] } };

const keydownRemovals = (): number =>
  (window.removeEventListener as unknown as SpiedListener).mock.calls.filter((call) => call[0] === 'keydown').length;

/**
 * The Escape handler was originally registered with `useState(() => …)`.
 * React treats that function as a lazy state initialiser: it runs during the
 * render phase, and the cleanup it returns is stored as state and discarded —
 * so the listener leaked on every mount and kept firing after unmount.
 * These tests pin both halves of the fixed behaviour.
 */
describe('TaskDetailPanel — Escape handling', () => {
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onClose = vi.fn();
    vi.spyOn(window, 'addEventListener');
    vi.spyOn(window, 'removeEventListener');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the task it is given', () => {
    render(<TaskDetailPanel task={mockTask} loading={false} onClose={onClose} />);
    expect(screen.getByText('TASK-1')).toBeInTheDocument();
    expect(screen.getByText('Test Task')).toBeInTheDocument();
  });

  it('closes when Escape is pressed', () => {
    render(<TaskDetailPanel task={mockTask} loading={false} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores other keys', () => {
    render(<TaskDetailPanel task={mockTask} loading={false} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'a' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('removes its listener on unmount, so it does not leak', () => {
    const { unmount } = render(<TaskDetailPanel task={mockTask} loading={false} onClose={onClose} />);
    const before = keydownRemovals();
    unmount();
    expect(keydownRemovals()).toBeGreaterThan(before);
  });

  it('does not call onClose after unmount', () => {
    const { unmount } = render(<TaskDetailPanel task={mockTask} loading={false} onClose={onClose} />);
    unmount();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
