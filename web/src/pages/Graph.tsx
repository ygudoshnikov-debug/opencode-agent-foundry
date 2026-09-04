import { useFoundryStore } from '@/stores/foundry';
import GraphCanvas from '@/components/GraphCanvas';
import LoadingSkeleton from '@/components/LoadingSkeleton';
import EmptyState from '@/components/EmptyState';

export default function Graph() {
  const { state } = useFoundryStore();

  if (!state.graph) {
    return (
      <div className="p-6">
        <LoadingSkeleton count={1} variant="card" height="500px" />
      </div>
    );
  }

  if (state.graph.order.length === 0) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <h1 className="text-2xl font-semibold">Task graph</h1>
        <EmptyState
          title="No tasks to graph"
          description="Create tasks to see the dependency graph"
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Task graph</h1>
        <p className="text-base-content/70 mt-1 text-sm">
          {state.graph.order.length} tasks • {state.graph.edges.length} edges
          {state.graph.critical_path.length > 0 && ` • Critical path: ${state.graph.critical_path.length}`}
        </p>
      </header>

      <GraphCanvas graph={state.graph} />
    </div>
  );
}
