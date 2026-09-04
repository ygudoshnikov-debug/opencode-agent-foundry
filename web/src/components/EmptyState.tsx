interface EmptyStateProps {
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export default function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
      <div className="text-4xl text-base-content/30">○</div>
      <h3 className="text-lg font-semibold text-base-content">{title}</h3>
      {description && (
        <p className="text-sm text-base-content/70 max-w-sm">{description}</p>
      )}
      {action && (
        <button className="btn btn-sm btn-primary mt-2" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
