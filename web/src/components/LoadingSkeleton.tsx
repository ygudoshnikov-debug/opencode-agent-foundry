interface LoadingSkeletonProps {
  count?: number;
  variant?: 'card' | 'row' | 'text';
  height?: string;
}

export default function LoadingSkeleton({
  count = 1,
  variant = 'card',
  height = '100px',
}: LoadingSkeletonProps) {
  return (
    <div className="space-y-4 p-4">
      {Array.from({ length: count }).map((_, i) => {
        if (variant === 'text') {
          return <div key={i} className="skeleton h-3 w-full"></div>;
        }
        if (variant === 'row') {
          return (
            <div key={i} className="flex gap-4">
              <div className="skeleton h-12 w-12 flex-shrink-0 rounded-full"></div>
              <div className="flex flex-col gap-2 flex-1">
                <div className="skeleton h-4 w-full"></div>
                <div className="skeleton h-3 w-3/4"></div>
              </div>
            </div>
          );
        }
        return (
          <div key={i} className="card shadow-sm">
            <div className="card-body gap-4">
              <div className="skeleton h-8 w-3/4"></div>
              <div className="flex flex-col gap-2">
                <div className="skeleton h-4 w-full"></div>
                <div className="skeleton h-4 w-5/6"></div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
