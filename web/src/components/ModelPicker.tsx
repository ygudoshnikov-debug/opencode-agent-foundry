import { useState } from 'react';

interface ModelPickerProps {
  value: string;
  onSave: (model: string) => Promise<void>;
  loading?: boolean;
  error?: string;
  readOnly?: boolean;
}

export default function ModelPicker({
  value,
  onSave,
  loading = false,
  error,
  readOnly = false,
}: ModelPickerProps) {
  const [input, setInput] = useState(value);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(input);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  if (readOnly) {
    return (
      <div className="px-4 py-2 bg-base-200 rounded text-base-content/70 text-sm">
        {value || '(inherits from chat model)'}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          className="input input-sm flex-1"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="provider/model — leave empty to use the chat model"
          disabled={saving || loading}
        />
        <button
          className="btn btn-sm btn-primary"
          onClick={handleSave}
          disabled={saving || loading || input === value}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
      {error && <p className="text-sm text-error">{error}</p>}
      {success && <p className="text-sm text-success">Saved!</p>}
    </div>
  );
}
