import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import GraphCanvas from './GraphCanvas';
import type { GraphView } from '@foundry/protocol';

const mockGraphView: GraphView = {
  edges: [
    { from: 'task-1', to: 'task-2', kind: 'depends_on' },
    { from: 'task-2', to: 'task-3', kind: 'depends_on' },
  ],
  critical_path: ['task-1', 'task-2', 'task-3'],
  cycles: [],
  missing: [],
  order: ['task-1', 'task-2', 'task-3'],
};

const graphWithCycles: GraphView = {
  ...mockGraphView,
  cycles: [['task-1', 'task-2', 'task-1']],
};

const graphWithMissing: GraphView = {
  ...mockGraphView,
  missing: [{ task: 'task-1', missing: 'task-999' }],
};

describe('GraphCanvas', () => {
  // These assert what the graph communicates, not which utility classes paint
  // it. A test pinned to a styling class passes just as happily when the CSS
  // behind that class has been deleted, which is how a whole surface can go
  // unstyled with a green suite.
  it('renders one node per task and one path per edge', () => {
    const { container } = render(<GraphCanvas graph={mockGraphView} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(container.querySelectorAll('rect')).toHaveLength(mockGraphView.order.length);
    expect(container.querySelectorAll('g > path')).toHaveLength(mockGraphView.edges.length);
  });

  it('should render legend with task and critical path items', () => {
    render(<GraphCanvas graph={mockGraphView} />);
    expect(screen.getByText('Task')).toBeInTheDocument();
    expect(screen.getByText('Critical path')).toBeInTheDocument();
  });

  it('should display cycle warning', () => {
    render(<GraphCanvas graph={graphWithCycles} />);
    expect(screen.getByText(/Cycles detected/)).toBeInTheDocument();
  });

  it('should display missing dependency warning', () => {
    render(<GraphCanvas graph={graphWithMissing} />);
    expect(screen.getByText(/Missing dependencies/)).toBeInTheDocument();
    expect(screen.getByText(/task-1 depends on task-999/)).toBeInTheDocument();
  });

  it('should render zoom controls with accessible names', () => {
    render(<GraphCanvas graph={mockGraphView} />);
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('should display blocked edge indicator', () => {
    const graphWithBlocked: GraphView = {
      ...mockGraphView,
      edges: [{ from: 'task-1', to: 'task-2', kind: 'blocks' }],
    };
    const { container } = render(<GraphCanvas graph={graphWithBlocked} />);
    // A blocking edge is drawn dashed, so it reads as different from a plain
    // dependency without relying on colour alone.
    const blockedEdge = container.querySelector('g > path[stroke-dasharray]');
    expect(blockedEdge).toBeInTheDocument();
  });

  it('places a task to the right of the deepest dependency it waits on', () => {
    // task-1 depends on task-2, which depends on task-3, so the columns must
    // read task-3, task-2, task-1 from left to right regardless of order.
    const { container } = render(<GraphCanvas graph={mockGraphView} />);
    const x = (id: string) => {
      const label = [...container.querySelectorAll('text')].find((node) => node.textContent === id);
      const group = label?.closest('g[transform]');
      return Number(/translate\(([-\d.]+),/.exec(group?.getAttribute('transform') ?? '')?.[1]);
    };
    expect(x('task-3')).toBeLessThan(x('task-2'));
    expect(x('task-2')).toBeLessThan(x('task-1'));
  });
});
