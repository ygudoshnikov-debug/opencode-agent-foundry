import { useEffect, useState } from 'react';
import type { Role } from '@foundry/protocol';
import { api } from '@/services/api';
import { useFoundryStore } from '@/stores/foundry';
import ModelPicker from '@/components/ModelPicker';
import LoadingSkeleton from '@/components/LoadingSkeleton';

/**
 * Settings is the desktop half of the same configuration the orchestrator
 * offers in chat. Both write the same project file through the same endpoints,
 * so whichever surface someone reaches for, the other reflects it — the builder
 * count set here is the ceiling the next foundry_execute actually uses.
 */
export default function Settings() {
  const { state, dispatch } = useFoundryStore();
  const [theme, setTheme] = useState<'light' | 'dark' | 'auto'>('auto');
  const [builders, setBuilders] = useState('');
  const [savingBuilders, setSavingBuilders] = useState(false);
  const [buildersError, setBuildersError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const configured = state.runtime?.builders;
  const presets = state.runtime?.presets ?? [];
  const activePreset = state.runtime?.active_preset ?? null;
  const [applyingPreset, setApplyingPreset] = useState<string | null>(null);

  const applyPreset = async (id: string) => {
    setApplyingPreset(id);
    try {
      const runtime = await api.setup({ choice: 'preset', preset: id });
      dispatch({ type: 'SET_RUNTIME', payload: runtime });
      const config = await api.config();
      dispatch({ type: 'SET_CONFIG', payload: config });
    } catch (error) {
      console.error('Failed to apply preset:', error);
    } finally {
      setApplyingPreset(null);
    }
  };

  // Mirror the stored value whenever the server reports a new one, including
  // after someone changes it from the chat side.
  useEffect(() => {
    if (configured !== undefined) setBuilders(String(configured));
  }, [configured]);

  const handleModelSave = async (role: Role, model: string) => {
    await api.setModel({ role, model });
    // The bridge broadcasts the change over SSE; every surface re-reads it.
  };

  const handleBuildersSave = async () => {
    const parsed = Number(builders);
    if (!Number.isInteger(parsed) || parsed < 0) {
      setBuildersError('Enter a whole number. 0 means unlimited.');
      return;
    }
    setBuildersError(null);
    setSavingBuilders(true);
    try {
      const runtime = await api.setup({ choice: 'custom', builders: parsed });
      dispatch({ type: 'SET_RUNTIME', payload: runtime });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      setBuildersError(error instanceof Error ? error.message : 'Could not save');
    } finally {
      setSavingBuilders(false);
    }
  };

  if (!state.config) {
    return (
      <div className="p-6">
        <LoadingSkeleton count={3} variant="card" />
      </div>
    );
  }

  const { config } = state;
  const parallel = config.execution.max_parallel;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-base-content/70 mt-1 text-sm">
          Changes apply to the next dispatch. No restart needed.
        </p>
      </header>

      <section className="card bg-base-100 border-base-300 border shadow-sm">
        <div className="card-body gap-4">
          <div>
            <h2 className="card-title text-lg">Model bindings</h2>
            <p className="text-base-content/70 text-sm">
              Which model each role runs on. Leave a binding empty to inherit the model selected in
              the chat.
            </p>
          </div>

          {/* The same presets the setup screen offers. Anything choosable in one
              place has to be choosable in the other, or the two surfaces start
              disagreeing about what this project can be. */}
          {presets.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base-content/70 text-sm">Apply a team:</span>
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={
                    activePreset === preset.id
                      ? 'btn btn-sm btn-primary'
                      : preset.available
                        ? 'btn btn-sm'
                        : 'btn btn-sm btn-outline'
                  }
                  disabled={applyingPreset !== null}
                  title={
                    preset.available
                      ? preset.summary
                      : `${preset.summary} (${preset.unavailable.join(', ')} not reachable)`
                  }
                  onClick={() => void applyPreset(preset.id)}
                >
                  {applyingPreset === preset.id ? (
                    <span className="loading loading-spinner loading-xs" />
                  ) : (
                    preset.label
                  )}
                </button>
              ))}
            </div>
          )}

          <ul className="flex flex-col gap-4">
            {config.models.map((binding) => (
              <li key={binding.role} className="bg-base-200 rounded-box p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium capitalize">{binding.role}</h3>
                  {!binding.configurable && (
                    <span className="badge badge-sm badge-ghost">Always uses the chat model</span>
                  )}
                </div>
                <p className="text-base-content/70 mt-1 mb-3 text-sm">{binding.description}</p>
                <ModelPicker
                  value={binding.model}
                  onSave={(model) => handleModelSave(binding.role as Role, model)}
                  readOnly={!binding.configurable}
                />
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="card bg-base-100 border-base-300 border shadow-sm">
        <div className="card-body gap-4">
          <div>
            <h2 className="card-title text-lg">Execution</h2>
            <p className="text-base-content/70 text-sm">
              How many builders may run at the same time. Tasks that touch the same files are still
              serialized, whatever this is set to.
            </p>
          </div>

          <fieldset className="fieldset">
            <label className="label" htmlFor="builders">
              Concurrent builders
            </label>
            <div className="join">
              <input
                id="builders"
                type="number"
                min={0}
                step={1}
                className={
                  buildersError
                    ? 'input input-sm input-error join-item w-32'
                    : 'input input-sm join-item w-32'
                }
                value={builders}
                onChange={(event) => setBuilders(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleBuildersSave();
                }}
                aria-describedby="builders-hint"
                aria-invalid={buildersError ? true : undefined}
              />
              <button
                type="button"
                className="btn btn-sm join-item"
                onClick={() => void handleBuildersSave()}
                disabled={savingBuilders}
              >
                {savingBuilders ? <span className="loading loading-spinner loading-xs" /> : 'Save'}
              </button>
            </div>
            <p className="label" id="builders-hint">
              {parallel === 0
                ? 'Currently unlimited — every independent task starts at once.'
                : `Currently ${parallel} at a time. Set 0 for unlimited.`}
            </p>
            {buildersError && (
              <p role="alert" className="text-error text-sm">
                {buildersError}
              </p>
            )}
            {saved && (
              <p role="status" className="text-success text-sm">
                Saved — the next run uses it.
              </p>
            )}
          </fieldset>

          <div className="stats stats-vertical sm:stats-horizontal bg-base-200">
            <div className="stat">
              <div className="stat-title">Same-file overlap</div>
              <div className="stat-value text-2xl">
                {config.execution.allow_file_overlap ? 'Allowed' : 'Serialized'}
              </div>
              <div className="stat-desc">Two tasks editing one file</div>
            </div>
            <div className="stat">
              <div className="stat-title">Retries per task</div>
              <div className="stat-value text-2xl">{config.execution.max_retries}</div>
              <div className="stat-desc">Before it escalates</div>
            </div>
          </div>
        </div>
      </section>

      <section className="card bg-base-100 border-base-300 border shadow-sm">
        <div className="card-body gap-4">
          <h2 className="card-title text-lg">Cost limits</h2>
          <div className="stats stats-vertical sm:stats-horizontal bg-base-200">
            <div className="stat">
              <div className="stat-title">Per task</div>
              <div className="stat-value text-2xl">${config.limits.max_cost_per_task_usd}</div>
              <div className="stat-desc">Estimated ceiling</div>
            </div>
            <div className="stat">
              <div className="stat-title">Per project</div>
              <div className="stat-value text-2xl">${config.limits.max_cost_per_project_usd}</div>
              <div className="stat-desc">Estimated ceiling</div>
            </div>
          </div>
        </div>
      </section>

      <section className="card bg-base-100 border-base-300 border shadow-sm">
        <div className="card-body gap-4">
          <h2 className="card-title text-lg">Desktop</h2>
          <div className="stats stats-vertical sm:stats-horizontal bg-base-200">
            <div className="stat">
              <div className="stat-title">Window</div>
              <div className="stat-value text-2xl">{config.desktop.enabled ? 'On' : 'Off'}</div>
              <div className="stat-desc">
                {config.desktop.autostart ? 'Starts with the plugin' : 'Opened on demand'}
              </div>
            </div>
            <div className="stat">
              <div className="stat-title">Bridge port</div>
              <div className="stat-value text-2xl">{config.desktop.port}</div>
              <div className="stat-desc">Loopback only</div>
            </div>
          </div>
        </div>
      </section>

      <section className="card bg-base-100 border-base-300 border shadow-sm">
        <div className="card-body gap-4">
          <h2 className="card-title text-lg">Appearance</h2>
          <fieldset className="fieldset">
            <label className="label" htmlFor="theme-select">
              Theme
            </label>
            <select
              id="theme-select"
              className="select select-sm w-full max-w-xs"
              value={theme}
              onChange={(event) => {
                const next = event.target.value as 'light' | 'dark' | 'auto';
                setTheme(next);
                if (next === 'auto') document.documentElement.removeAttribute('data-theme');
                else document.documentElement.setAttribute('data-theme', next);
              }}
            >
              <option value="auto">Follow the system</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </fieldset>
        </div>
      </section>

      <section className="card bg-base-200 border-base-300 border">
        <div className="card-body gap-2">
          <h2 className="card-title text-base">Where this came from</h2>
          <ul className="flex flex-col gap-1">
            {config.source.map((path) => (
              <li key={path}>
                <code className="text-xs break-all">{path}</code>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
