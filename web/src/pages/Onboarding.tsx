import { useState } from 'react';
import type { ApplySetupRequest, ResolvedPresetView, RuntimeView } from '@foundry/protocol';
import { api } from '@/services/api';
import ErrorState from '@/components/ErrorState';
import LoadingSkeleton from '@/components/LoadingSkeleton';

interface OnboardingProps {
  runtime: RuntimeView;
  loading?: boolean;
  error?: string | null;
  onComplete: (runtime: RuntimeView) => void;
  onCancel?: () => void;
}

const ROLES = ['architect', 'lead', 'analyst', 'builder'] as const;
type Role = (typeof ROLES)[number];

/** What the human picks. Presets and the two open-ended options share one list. */
type Selection = { kind: 'preset'; id: string } | { kind: 'inherit' } | { kind: 'custom' };

/**
 * The setup screen.
 *
 * Chat asks one either/or question and sends people here for everything else,
 * because this is the surface that can actually show what it is offering: four
 * vendor teams with the model behind each role, and whether the account can
 * reach them. Four dropdowns each defaulting to "use defaults" asked the human
 * to already know four models and how they rank before they could start.
 */
export default function Onboarding({ runtime, loading, error, onComplete, onCancel }: OnboardingProps) {
  const [selection, setSelection] = useState<Selection | null>(
    runtime.active_preset ? { kind: 'preset', id: runtime.active_preset } : null,
  );
  const [custom, setCustom] = useState<Record<Role, string>>(() => {
    const seed = {} as Record<Role, string>;
    for (const role of ROLES) seed[role] = runtime.models.find((m) => m.role === role)?.model ?? '';
    return seed;
  });
  const [builders, setBuilders] = useState<number>(runtime.builders);
  const [unlimited, setUnlimited] = useState(runtime.builders === 0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (loading) return <LoadingSkeleton count={4} variant="card" />;
  if (error) return <ErrorState error={error} />;

  const submit = async () => {
    if (!selection) return;
    setSaving(true);
    setSaveError(null);
    try {
      const request: ApplySetupRequest = {
        choice: selection.kind,
        builders: unlimited ? 0 : builders,
        ...(selection.kind === 'preset' ? { preset: selection.id } : {}),
        ...(selection.kind === 'custom' ? { models: custom } : {}),
      };
      onComplete(await api.setup(request));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setSaving(false);
    }
  };

  const isChosen = (candidate: Selection) =>
    selection?.kind === candidate.kind &&
    (candidate.kind !== 'preset' || (selection as { id: string }).id === candidate.id);

  const cardClass = (chosen: boolean) =>
    chosen
      ? 'card bg-base-100 border-primary cursor-pointer border-2 shadow-sm'
      : 'card bg-base-100 border-base-300 hover:border-base-content/30 cursor-pointer border shadow-sm';

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <header className="text-center">
        <h1 className="text-3xl font-bold">Agent Foundry setup</h1>
        <p className="text-base-content/70 mt-2">
          Pick the team that does the work. The orchestrator you talk to always runs on the model
          selected in the chat.
        </p>
      </header>

      {saveError && (
        <div role="alert" className="alert alert-error">
          <span>{saveError}</span>
        </div>
      )}

      <fieldset className="fieldset gap-3">
        <legend className="fieldset-legend text-base">Choose a team</legend>

        {runtime.presets.map((preset) => (
          <PresetCard
            key={preset.id}
            preset={preset}
            chosen={isChosen({ kind: 'preset', id: preset.id })}
            className={cardClass(isChosen({ kind: 'preset', id: preset.id }))}
            onChoose={() => setSelection({ kind: 'preset', id: preset.id })}
          />
        ))}

        <label className={cardClass(isChosen({ kind: 'inherit' }))}>
          <div className="card-body flex-row items-start gap-4 p-4">
            <input
              type="radio"
              name="foundry-setup"
              className="radio radio-sm mt-1"
              checked={isChosen({ kind: 'inherit' })}
              onChange={() => setSelection({ kind: 'inherit' })}
            />
            <div>
              <h2 className="card-title text-base">Inherit from chat</h2>
              <p className="text-base-content/70 text-sm">
                Every role runs on whichever model you have selected in the chat. Nothing is pinned.
              </p>
            </div>
          </div>
        </label>

        <label className={cardClass(isChosen({ kind: 'custom' }))}>
          <div className="card-body flex-row items-start gap-4 p-4">
            <input
              type="radio"
              name="foundry-setup"
              className="radio radio-sm mt-1"
              checked={isChosen({ kind: 'custom' })}
              onChange={() => setSelection({ kind: 'custom' })}
            />
            <div>
              <h2 className="card-title text-base">Choose per role</h2>
              <p className="text-base-content/70 text-sm">
                Pick a model for each role yourself, from what your account can reach.
              </p>
            </div>
          </div>
        </label>
      </fieldset>

      {selection?.kind === 'custom' && (
        <section className="card bg-base-200 border-base-300 border">
          <div className="card-body gap-4">
            <h2 className="card-title text-base">Model per role</h2>
            {ROLES.map((role) => (
              <fieldset className="fieldset" key={role}>
                <label className="label capitalize" htmlFor={`model-${role}`}>
                  {role}
                </label>
                <select
                  id={`model-${role}`}
                  className="select select-sm w-full"
                  value={custom[role]}
                  onChange={(event) => setCustom({ ...custom, [role]: event.target.value })}
                >
                  <option value="">Inherit from chat</option>
                  {runtime.catalogue.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.provider} · {model.name}
                    </option>
                  ))}
                </select>
              </fieldset>
            ))}
            {runtime.catalogue.length === 0 && (
              <p role="status" className="text-base-content/70 text-sm">
                No model list available right now, so every role will inherit the chat model.
              </p>
            )}
          </div>
        </section>
      )}

      <section className="card bg-base-100 border-base-300 border shadow-sm">
        <div className="card-body gap-3">
          <h2 className="card-title text-base">Concurrent builders</h2>
          <p className="text-base-content/70 text-sm">
            How many build tasks run at the same time. Tasks touching the same files are serialized
            regardless.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <input
              type="number"
              min={1}
              step={1}
              className="input input-sm w-28"
              aria-label="Concurrent builders"
              value={unlimited ? '' : builders}
              disabled={unlimited}
              onChange={(event) => setBuilders(Math.max(1, Number(event.target.value) || 1))}
            />
            <label className="label cursor-pointer gap-2">
              <input
                type="checkbox"
                className="toggle toggle-sm"
                checked={unlimited}
                onChange={(event) => setUnlimited(event.target.checked)}
              />
              Unlimited
            </label>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          disabled={!selection || saving}
          onClick={() => void submit()}
        >
          {saving ? <span className="loading loading-spinner loading-sm" /> : 'Save setup'}
        </button>
      </div>
    </div>
  );
}

function PresetCard({
  preset,
  chosen,
  className,
  onChoose,
}: {
  preset: ResolvedPresetView;
  chosen: boolean;
  className: string;
  onChoose: () => void;
}) {
  return (
    <label className={className}>
      <div className="card-body gap-3 p-4">
        <div className="flex items-start gap-4">
          <input
            type="radio"
            name="foundry-setup"
            className="radio radio-sm mt-1"
            checked={chosen}
            onChange={onChoose}
          />
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="card-title text-base">{preset.label}</h2>
              {!preset.available && (
                <span className="badge badge-sm badge-warning">
                  {preset.unavailable.length} role
                  {preset.unavailable.length === 1 ? '' : 's'} unreachable
                </span>
              )}
            </div>
            <p className="text-base-content/70 text-sm">{preset.summary}</p>
          </div>
        </div>

        {/* The models themselves, because "OpenAI" alone does not tell anyone
            what will actually run their build tasks. */}
        <dl className="border-base-300 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t pt-3 text-xs">
          {ROLES.map((role) => (
            <div key={role} className="contents">
              <dt className="text-base-content/60 capitalize">{role}</dt>
              <dd className="truncate font-mono" title={preset.models[role] || 'inherits from chat'}>
                {preset.models[role] || (
                  <span className="text-warning">inherits from chat — not reachable</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </label>
  );
}
