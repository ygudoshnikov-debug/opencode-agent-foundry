import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EventFeed from './EventFeed';
import type { FoundryEvent } from '@foundry/protocol';

const mockEvents: FoundryEvent[] = [
  {
    seq: 1,
    type: 'TASK_CREATED',
    actor: 'architect',
    message: 'Created task-1',
    at: new Date().toISOString(),
  },
  {
    seq: 2,
    type: 'TASK_STATUS_CHANGED',
    actor: 'builder',
    message: 'Changed status from BACKLOG to IN_PROGRESS',
    at: new Date().toISOString(),
  },
];

describe('EventFeed', () => {
  it('should render events', () => {
    render(<EventFeed events={mockEvents} />);
    // Check that event types are displayed in the cards
    const allText = screen.getAllByText('TASK CREATED');
    expect(allText.length).toBeGreaterThan(0);
    const allStatusChanged = screen.getAllByText('TASK STATUS CHANGED');
    expect(allStatusChanged.length).toBeGreaterThan(0);
  });

  it('should render event summaries', () => {
    render(<EventFeed events={mockEvents} />);
    expect(screen.getByText('Created task-1')).toBeInTheDocument();
    expect(screen.getByText('Changed status from BACKLOG to IN_PROGRESS')).toBeInTheDocument();
  });

  it('should render actor names', () => {
    render(<EventFeed events={mockEvents} />);
    expect(screen.getByText(/by architect/)).toBeInTheDocument();
    expect(screen.getByText(/by builder/)).toBeInTheDocument();
  });

  it('should filter events by type', () => {
    const onFilterChange = vi.fn();
    render(<EventFeed events={mockEvents} typeFilter="TASK_CREATED" onFilterChange={onFilterChange} />);

    // When filtered, only the matching event should be shown
    expect(screen.getByText('Created task-1')).toBeInTheDocument();
    expect(screen.queryByText('Changed status from BACKLOG to IN_PROGRESS')).not.toBeInTheDocument();
  });

  it('should show empty state when no events', () => {
    render(<EventFeed events={[]} />);
    expect(screen.getByText('No events yet')).toBeInTheDocument();
  });

  it('should call onFilterChange when type filter changes', () => {
    const onFilterChange = vi.fn();
    render(<EventFeed events={mockEvents} onFilterChange={onFilterChange} />);

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'TASK_STATUS_CHANGED' } });

    expect(onFilterChange).toHaveBeenCalledWith('TASK_STATUS_CHANGED');
  });

  it('should append new events', () => {
    const newEvent: FoundryEvent = {
      seq: 3,
      type: 'TASK_UPDATED',
      actor: 'analyst',
      message: 'Updated task metadata',
      at: new Date().toISOString(),
    };

    const { rerender } = render(<EventFeed events={mockEvents} />);
    expect(screen.getByText('Created task-1')).toBeInTheDocument();
    expect(screen.getByText('Changed status from BACKLOG to IN_PROGRESS')).toBeInTheDocument();

    rerender(<EventFeed events={[newEvent, ...mockEvents]} />);
    expect(screen.getByText('Updated task metadata')).toBeInTheDocument();
    expect(screen.getByText('Created task-1')).toBeInTheDocument();
  });
});
