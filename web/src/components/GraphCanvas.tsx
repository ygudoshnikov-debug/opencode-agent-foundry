import { useState, useRef, useEffect } from 'react';
import type { GraphView } from '@foundry/protocol';

interface GraphCanvasProps {
  graph: GraphView;
}

interface NodePosition {
  x: number;
  y: number;
}

/**
 * A horizontal S-curve between two nodes. A dependency edge leaves the left
 * edge of the dependent and lands on the right edge of what it waits on; a
 * forward edge (blocks, parent_of) runs the other way.
 */
function edgePath(from: NodePosition, to: NodePosition, forward: boolean): string {
  const width = 140;
  const middle = 30;
  const x1 = forward ? from.x + width : from.x;
  const x2 = forward ? to.x : to.x + width;
  const y1 = from.y + middle;
  const y2 = to.y + middle;
  const bend = forward ? 48 : -48;
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

export default function GraphCanvas({ graph }: GraphCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Layered layout: a task sits one column to the right of the deepest
  // dependency it waits on, so the critical path reads left to right and
  // independent work stacks vertically. Positions derive from the edges, not
  // from a task's index in the order, so the picture is a picture of the graph.
  const NODE_W = 140;
  const NODE_H = 60;
  const COLUMN = 210;
  const ROW = 96;
  const MARGIN = 40;

  const upstreamOf = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.kind !== 'depends_on') continue;
    const list = upstreamOf.get(edge.from);
    if (list) list.push(edge.to);
    else upstreamOf.set(edge.from, [edge.to]);
  }
  const level = new Map<string, number>();
  const depthOf = (id: string, seen: Set<string>): number => {
    const known = level.get(id);
    if (known !== undefined) return known;
    if (seen.has(id)) return 0; // a cycle is reported above; do not recurse into it
    seen.add(id);
    const upstream = upstreamOf.get(id) ?? [];
    const value = upstream.length ? 1 + Math.max(...upstream.map((dep) => depthOf(dep, seen))) : 0;
    level.set(id, value);
    return value;
  };

  const nodePositions: Record<string, NodePosition> = {};
  const rowsPerColumn = new Map<number, number>();
  for (const id of graph.order) {
    const column = depthOf(id, new Set());
    const row = rowsPerColumn.get(column) ?? 0;
    rowsPerColumn.set(column, row + 1);
    nodePositions[id] = { x: column * COLUMN + MARGIN, y: row * ROW + MARGIN };
  }
  const columns = Math.max(1, ...[...level.values()].map((value) => value + 1));
  const rows = Math.max(1, ...rowsPerColumn.values());
  const viewWidth = Math.max(1000, columns * COLUMN + MARGIN);
  const viewHeight = Math.max(600, rows * ROW + MARGIN);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.max(0.5, Math.min(3, z * delta)));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2 || e.ctrlKey || e.metaKey) {
      setDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (dragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setDragging(false);
  };

  const isOnCriticalPath = (id: string) => graph.critical_path.includes(id);

  return (
    <div className="border-base-300 bg-base-100 rounded-box relative flex min-h-0 flex-1 flex-col gap-3 border p-3">
      {graph.cycles.length > 0 && (
        <div role="alert" className="alert alert-warning">
          <span>
            <strong>Cycles detected:</strong> {graph.cycles.map((c) => c.join(' → ')).join('; ')}
          </span>
        </div>
      )}

      {graph.missing.length > 0 && (
        <div role="alert" className="alert alert-error">
          <div>
            <strong>Missing dependencies:</strong>
            <ul className="mt-1 flex flex-col gap-0.5 text-sm">
              {graph.missing.map((m) => (
                <li key={`${m.task}->${m.missing}`}>
                  {m.task} depends on {m.missing}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <svg
        ref={svgRef}
        className="bg-base-200 rounded-box min-h-0 w-full flex-1 touch-none [user-select:none]"
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        preserveAspectRatio="xMinYMin meet"
        role="img"
        aria-label={`Dependency graph: ${graph.order.length} tasks, ${graph.edges.length} dependencies`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="10"
            refX="9"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 10 3, 0 6" className="fill-base-content/40" />
          </marker>
          <marker
            id="arrowhead-critical"
            markerWidth="10"
            markerHeight="10"
            refX="9"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 10 3, 0 6" className="fill-primary" />
          </marker>
        </defs>

        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {/* Edges */}
          {graph.edges.map((edge, i) => {
            const from = nodePositions[edge.from];
            const to = nodePositions[edge.to];
            if (!from || !to) return null;

            const isCritical =
              graph.critical_path.includes(edge.from) && graph.critical_path.includes(edge.to);
            const isBlocking = edge.kind === 'blocks';

            return (
              <path
                // Identity, not position: edges are re-derived from the task
                // list, and creating a task can reorder them. With an index key
                // React would repaint existing paths into the wrong geometry.
                key={`${edge.kind}:${edge.from}->${edge.to}`}
                d={edgePath(from, to, edge.kind === 'blocks' || edge.kind === 'parent_of')}
                fill="none"
                strokeDasharray={isBlocking ? '4 3' : undefined}
                className={isCritical ? 'stroke-primary' : 'stroke-base-content/40'}
                markerEnd={isCritical ? 'url(#arrowhead-critical)' : 'url(#arrowhead)'}
                strokeWidth={isCritical ? 2 : 1}
              />
            );
          })}

          {/* Nodes */}
          {graph.order.map((id) => {
            const pos = nodePositions[id];
            if (!pos) return null;

            const isCritical = isOnCriticalPath(id);

            return (
              <g key={id} transform={`translate(${pos.x},${pos.y})`}>
                <rect
                  className={
                    isCritical
                      ? 'fill-base-100 stroke-primary stroke-2'
                      : 'fill-base-100 stroke-base-content/30'
                  }
                  width={NODE_W}
                  height={NODE_H}
                  rx="4"
                />
                <text
                  className="fill-base-content"
                  x="70"
                  y="20"
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="bold"
                >
                  {id.slice(0, 12)}
                  {id.length > 12 ? '...' : ''}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ul className="text-base-content/70 flex flex-wrap items-center gap-4 text-xs">
          <li className="flex items-center gap-2">
            <span className="border-base-content/30 bg-base-100 h-3 w-5 rounded-xs border" />
            Task
          </li>
          <li className="flex items-center gap-2">
            <span className="border-primary bg-base-100 h-3 w-5 rounded-xs border-2" />
            Critical path
          </li>
          <li className="flex items-center gap-2">
            <span className="border-base-content/40 w-5 border-t-2 border-dashed" />
            Blocking
          </li>
        </ul>
        <div className="join">
          <button
            type="button"
            className="btn btn-xs join-item"
            aria-label="Zoom out"
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.2))}
          >
            −
          </button>
          <span className="btn btn-xs join-item pointer-events-none tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            className="btn btn-xs join-item"
            aria-label="Zoom in"
            onClick={() => setZoom((z) => Math.min(3, z + 0.2))}
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
