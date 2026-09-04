import { AlertTriangle, CircleHelp, Play } from 'lucide-react';
import { useFoundryStore } from '@/stores/foundry';
import { STATUS_LABELS } from '@/types/status';

/**
 * The dashboard is the run at a glance: the objective, where the flow is, and
 * the numbers that decide what happens next. Values stay in the base content
 * color; semantic color is reserved for things that are actually a state —
 * the run status, blocked work, and questions still waiting on a human.
 */
export default function Dashboard() {
  const { state } = useFoundryStore();

  if (!state.project) {
    return (
      <div className="p-6">
        <div className="skeleton h-24 w-full" />
      </div>
    );
  }

  const { project } = state;
  const byStatus = project.totals?.by_status ?? {};
  const count = (status: keyof typeof STATUS_LABELS) => byStatus[status] ?? 0;
  const running = project.running ?? [];
  const blocked = project.blocked ?? [];
  const questions = project.open_questions ?? [];
  const waiting = questions.filter((question) => !question.answer);
  const runStatus = project.status ?? 'active';
  const statusDot =
    runStatus === 'completed' ? 'status status-success' : runStatus === 'paused' ? 'status status-warning' : 'status status-info';

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <span className="badge badge-soft badge-sm">{project.phase ?? 'UNKNOWN'}</span>
          <span className="text-base-content/70 flex items-center gap-2 text-sm">
            <span className={statusDot} aria-hidden="true" />
            {runStatus}
          </span>
        </div>
        {project.objective && (
          <p className="text-base-content text-lg leading-snug" title={project.objective}>
            {project.objective}
          </p>
        )}
      </header>

      <div className="stats stats-vertical lg:stats-horizontal border-base-300 bg-base-100 w-full border">
        <div className="stat">
          <div className="stat-title">Progress</div>
          <div className="stat-value tabular-nums">{project.progress?.percent ?? 0}%</div>
          <div className="stat-desc">
            {project.progress?.done ?? 0} of {project.progress?.total ?? 0} tasks done
          </div>
          <progress
            className="progress mt-2 w-full"
            value={project.progress?.percent ?? 0}
            max={100}
            aria-label="Overall progress"
          />
        </div>

        <div className="stat">
          <div className="stat-title">Tasks</div>
          <div className="stat-value tabular-nums">{project.totals?.tasks ?? 0}</div>
          <div className="stat-desc">
            {count('IN_PROGRESS')} in progress · {count('REVIEW')} in review · {count('BLOCKED') + count('FAILED')}{' '}
            blocked or failed
          </div>
        </div>

        <div className="stat">
          <div className="stat-title">Estimated cost</div>
          <div className="stat-value tabular-nums">${(project.cost_usd ?? 0).toFixed(2)}</div>
          <div className="stat-desc tabular-nums">{(project.tokens ?? 0).toLocaleString()} tokens</div>
        </div>

        <div className="stat">
          <div className="stat-title">Plans</div>
          <div className="stat-value tabular-nums">{project.plans ?? 0}</div>
          <div className="stat-desc">
            {project.critical_path?.length
              ? `Critical path: ${project.critical_path.length} tasks`
              : 'No critical path yet'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="card bg-base-100 border-base-300 border">
          <div className="card-body gap-3">
            <h2 className="card-title text-base">
              <Play className="h-4 w-4" aria-hidden="true" />
              Running
              <span className="badge badge-sm badge-ghost">{running.length}</span>
            </h2>
            {running.length === 0 ? (
              <p className="text-base-content/70 text-sm">
                Nothing is executing. Ready tasks start on the next execution call.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {running.map((taskId) => (
                  <li key={taskId} className="bg-base-200 rounded-box flex items-center gap-3 px-3 py-2">
                    <span className="status status-info" aria-hidden="true" />
                    <span className="font-mono text-sm">{taskId}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="card bg-base-100 border-base-300 border">
          <div className="card-body gap-3">
            <h2 className="card-title text-base">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              Blocked
              <span className="badge badge-sm badge-ghost">{blocked.length}</span>
            </h2>
            {blocked.length === 0 ? (
              <p className="text-base-content/70 text-sm">No task is waiting on another.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {blocked.map((item) => (
                  <li key={item.id} className="bg-base-200 rounded-box flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                    <span className="font-mono">{item.id}</span>
                    <span className="text-base-content/70">
                      waiting on {item.waiting_for.join(', ') || 'an external dependency'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <section className="card bg-base-100 border-base-300 border">
        <div className="card-body gap-3">
          <h2 className="card-title text-base">
            <CircleHelp className="h-4 w-4" aria-hidden="true" />
            Questions
            {waiting.length > 0 && <span className="badge badge-sm badge-warning">{waiting.length} waiting</span>}
          </h2>
          {questions.length === 0 ? (
            <p className="text-base-content/70 text-sm">The orchestrator has not needed to ask anything.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {questions.map((question) => (
                <li key={question.id} className="bg-base-200 rounded-box px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-base-content/60 font-mono text-xs">{question.id}</span>
                    <span className="font-medium">{question.question}</span>
                  </div>
                  <p className="text-base-content/70 mt-1">
                    {question.answer ? `Answer: ${question.answer}` : 'Waiting for an answer.'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
