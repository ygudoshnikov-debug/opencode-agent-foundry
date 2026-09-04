import { useState, useEffect } from 'react';
import { api } from '@/services/api';
import { useFoundryStore } from '@/stores/foundry';
import EventFeed from '@/components/EventFeed';
import LoadingSkeleton from '@/components/LoadingSkeleton';

export default function Events() {
  const { state, dispatch } = useFoundryStore();
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadEvents = async () => {
      setLoading(true);
      try {
        const events = await api.events(100);
        dispatch({ type: 'SET_EVENTS', payload: events });
      } catch (error) {
        console.error('Failed to load events:', error);
      } finally {
        setLoading(false);
      }
    };

    loadEvents();
  }, [dispatch]);

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Events</h1>
        <p className="text-base-content/70 text-sm">
          {state.events.length} recorded
        </p>
      </header>

      {loading ? (
        <LoadingSkeleton count={5} variant="row" />
      ) : (
        <EventFeed events={state.events} typeFilter={typeFilter} onFilterChange={setTypeFilter} />
      )}
    </div>
  );
}
