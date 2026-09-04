import type { FoundryEvent } from '@foundry/protocol';

interface EventFeedProps {
  events: FoundryEvent[];
  typeFilter?: string;
  onFilterChange?: (filter: string) => void;
}

const EVENT_TYPES = [
  'ALL',
  'PHASE_CHANGED',
  'QUESTION_ASKED',
  'QUESTION_ANSWERED',
  'PLAN_SUBMITTED',
  'PLAN_APPLIED',
  'TASK_CREATED',
  'TASK_UPDATED',
  'TASK_STATUS_CHANGED',
  'TASK_STARTED',
  'TASK_COMPLETED',
  'TASK_FAILED',
  'TASK_BLOCKED',
  'TASK_UNBLOCKED',
  'REVIEW_DECIDED',
  'ESCALATION_RAISED',
  'SCHEDULER_DECISION',
  'COST_RECORDED',
];

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString();
}

function getEventIcon(type: string): string {
  const icons: Record<string, string> = {
    PHASE_CHANGED: '⇢',
    QUESTION_ASKED: '?',
    QUESTION_ANSWERED: '!',
    PLAN_SUBMITTED: '⊞',
    PLAN_APPLIED: '☑',
    TASK_CREATED: '+',
    TASK_UPDATED: '◆',
    TASK_STATUS_CHANGED: '→',
    TASK_STARTED: '▶',
    TASK_COMPLETED: '✓',
    TASK_FAILED: '✕',
    TASK_BLOCKED: '⊗',
    TASK_UNBLOCKED: '⊙',
    REVIEW_DECIDED: '⚖',
    ESCALATION_RAISED: '↑',
    SCHEDULER_DECISION: '≡',
    COST_RECORDED: '$',
  };
  return icons[type] || '•';
}

export default function EventFeed({ events, typeFilter = 'ALL', onFilterChange }: EventFeedProps) {
  const filteredEvents = typeFilter === 'ALL' ? events : events.filter((e) => e.type === typeFilter);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <label htmlFor="event-type-filter" className="text-sm font-medium">
          Filter by type:
        </label>
        <select
          id="event-type-filter"
          value={typeFilter}
          onChange={(e) => onFilterChange?.(e.target.value)}
          className="select select-sm flex-1 max-w-xs"
        >
          {EVENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {type === 'ALL' ? 'All events' : type.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      {filteredEvents.length === 0 ? (
        <div className="text-center py-12 text-base-content/50">
          <p className="text-sm">No events yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredEvents.map((event) => (
            <div key={event.seq} className="card bg-base-100 border border-base-300">
              <div className="card-body gap-2 p-4">
                <div className="flex items-start gap-3">
                  <div className="text-lg text-primary flex-shrink-0 w-6 text-center">
                    {getEventIcon(event.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-base-content">
                      {event.type.replace(/_/g, ' ')}
                    </div>
                    <div className="text-sm text-base-content/80 mt-1">{event.message}</div>
                    <div className="text-xs text-base-content/50 mt-2 flex flex-wrap gap-2">
                      {event.actor && <span>by {event.actor}</span>}
                      <span>{formatTime(event.at)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
