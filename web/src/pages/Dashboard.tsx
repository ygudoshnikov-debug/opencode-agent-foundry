import { useFoundryStore } from '@/stores/foundry';
import ProgressBar from '@/components/ProgressBar';

export default function Dashboard() {
  const { state } = useFoundryStore();

  if (!state.project) {
    return (
      <div className="p-8">
        <div className="skeleton h-20 w-full"></div>
      </div>
    );
  }

  const { project } = state;

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-base-content">Dashboard</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {project.objective && (
          <div className="card bg-base-100 border border-base-300">
            <div className="card-body">
              <h3 className="card-title text-base">Objective</h3>
              <p className="text-lg font-semibold text-primary">{project.objective}</p>
            </div>
          </div>
        )}

        <div className="card bg-base-100 border border-base-300">
          <div className="card-body">
            <h3 className="card-title text-base">Phase</h3>
            <p className="text-lg font-semibold text-accent">{project.phase || 'Unknown'}</p>
          </div>
        </div>

        <div className="card bg-base-100 border border-base-300">
          <div className="card-body">
            <h3 className="card-title text-base">Status</h3>
            <p className="text-lg font-semibold text-success">{project.status || 'Unknown'}</p>
          </div>
        </div>

        <div className="card bg-base-100 border border-base-300">
          <div className="card-body">
            <h3 className="card-title text-base">Progress</h3>
            <ProgressBar percent={project.progress?.percent || 0} showLabel={true} />
            <p className="text-sm text-base-content/70 mt-2">
              {project.progress?.done || 0} / {project.progress?.total || 0} tasks
            </p>
          </div>
        </div>

        <div className="card bg-base-100 border border-base-300">
          <div className="card-body">
            <h3 className="card-title text-base">Total Tasks</h3>
            <p className="text-lg font-semibold text-primary">{project.totals?.tasks || 0}</p>
          </div>
        </div>

        <div className="card bg-base-100 border border-base-300">
          <div className="card-body">
            <h3 className="card-title text-base">Cost</h3>
            <p className="text-lg font-semibold text-warning">${project.cost_usd?.toFixed(2) || '0.00'}</p>
          </div>
        </div>

        <div className="card bg-base-100 border border-base-300">
          <div className="card-body">
            <h3 className="card-title text-base">Tokens Used</h3>
            <p className="text-lg font-semibold text-info">{project.tokens?.toLocaleString() || '0'}</p>
          </div>
        </div>

        <div className="card bg-base-100 border border-base-300">
          <div className="card-body">
            <h3 className="card-title text-base">Plans</h3>
            <p className="text-lg font-semibold text-secondary">{project.plans || 0}</p>
          </div>
        </div>
      </div>

      {project.running?.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold text-base-content">Running Tasks</h2>
          <div className="space-y-2">
            {project.running.map((taskId) => (
              <div key={taskId} className="card bg-base-100 border border-base-300">
                <div className="card-body py-2 px-4">{taskId}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {project.blocked?.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold text-base-content">Blocked Tasks</h2>
          <div className="space-y-2">
            {project.blocked.map((block) => (
              <div key={block.id} className="alert alert-warning">
                <div>
                  <strong>{block.id}</strong> waiting for: {block.waiting_for.join(', ')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {project.open_questions?.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold text-base-content">Open Questions</h2>
          <div className="space-y-2">
            {project.open_questions.map((q) => (
              <div key={q.id} className="card bg-base-100 border border-base-300">
                <div className="card-body">
                  <strong>{q.question}</strong>
                  {q.answer && <p className="text-sm text-base-content/70 mt-2">Answer: {q.answer}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
