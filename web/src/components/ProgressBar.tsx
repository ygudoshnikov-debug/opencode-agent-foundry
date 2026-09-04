interface ProgressBarProps {
  percent: number;
  showLabel?: boolean;
  variant?: 'default' | 'success' | 'warning' | 'error';
  height?: string;
}

const variantColorMap: Record<string, string> = {
  default: 'progress-primary',
  success: 'progress-success',
  warning: 'progress-warning',
  error: 'progress-error',
};

export default function ProgressBar({
  percent,
  showLabel = true,
  variant = 'default',
  height = '8px',
}: ProgressBarProps) {
  const safePercent = Math.max(0, Math.min(100, percent));
  const colorClass = variantColorMap[variant] || 'progress-primary';

  return (
    <div className="flex items-center gap-2">
      <progress
        className={`progress ${colorClass} flex-1`}
        value={safePercent}
        max="100"
        style={{ height }}
      />
      {showLabel && (
        <span className="text-sm font-semibold text-base-content whitespace-nowrap">
          {Math.round(safePercent)}%
        </span>
      )}
    </div>
  );
}
