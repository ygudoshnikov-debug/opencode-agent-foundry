import { AlertCircle, X } from 'lucide-react';

interface ErrorStateProps {
  error: string;
  onDismiss?: () => void;
}

export default function ErrorState({ error, onDismiss }: ErrorStateProps) {
  return (
    <div role="alert" className="alert alert-error max-w-md mx-auto my-4">
      <div className="flex gap-3 w-full">
        <AlertCircle className="w-6 h-6 flex-shrink-0" />
        <div className="flex-1">
          <h2 className="font-semibold">Error</h2>
          <p className="text-sm mt-1">{error}</p>
        </div>
        {onDismiss && (
          <button className="btn btn-sm btn-ghost btn-square" onClick={onDismiss} aria-label="Dismiss error">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
