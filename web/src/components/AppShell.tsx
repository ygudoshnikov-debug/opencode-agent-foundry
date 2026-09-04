import { useCallback, useEffect, useState } from 'react';
import { useConnection } from '@/hooks';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useFoundryStore } from '@/stores/foundry';
import { api } from '@/services/api';
import type { StreamFrame, RuntimeView } from '@foundry/protocol';
import TitleBar from './TitleBar';
import Sidebar from './Sidebar';
import ConnectionBanner from './ConnectionBanner';
import Dashboard from '@/pages/Dashboard';
import Kanban from '@/pages/Kanban';
import Tasks from '@/pages/Tasks';
import Graph from '@/pages/Graph';
import Events from '@/pages/Events';
import Settings from '@/pages/Settings';
import Onboarding from '@/pages/Onboarding';
import ErrorState from './ErrorState';
import ShortcutOverlay from './ShortcutOverlay';

export default function AppShell() {
  const [currentPage, setCurrentPage] = useState<string>('dashboard');
  const [showHelp, setShowHelp] = useState(false);
  const { state, dispatch } = useFoundryStore();

  /**
   * Refetches exactly the scopes the server says have changed.
   *
   * Each request is independently tolerant: one failing endpoint must not blank
   * the rest of the UI, so a rejection leaves that slice showing its previous
   * value rather than clearing it.
   */
  const refresh = useCallback(
    async (scopes: ReadonlyArray<'board' | 'project' | 'graph' | 'config' | 'events'>) => {
      const wanted = new Set(scopes);
      await Promise.all([
        wanted.has('project')
          ? api.project().then((p) => dispatch({ type: 'SET_PROJECT', payload: p })).catch(() => undefined)
          : undefined,
        wanted.has('board')
          ? api.board().then((b) => dispatch({ type: 'SET_BOARD', payload: b })).catch(() => undefined)
          : undefined,
        wanted.has('graph')
          ? api.graph().then((g) => dispatch({ type: 'SET_GRAPH', payload: g })).catch(() => undefined)
          : undefined,
        wanted.has('config')
          ? api.config().then((c) => dispatch({ type: 'SET_CONFIG', payload: c })).catch(() => undefined)
          : undefined,
      ]);
    },
    [dispatch],
  );

  const handleStreamFrame = useCallback(
    (frame: StreamFrame) => {
      if (frame.type === 'event') {
        dispatch({ type: 'ADD_EVENT', payload: frame.event });
        return;
      }
      if (frame.type === 'invalidate') {
        // The server tells us WHAT changed rather than pushing the new state,
        // so the payload stays tiny and the client refetches only what it needs.
        void refresh(frame.scopes);
      }
    },
    [dispatch, refresh],
  );

  const { status } = useConnection({
    onFrame: handleStreamFrame,
    onStatusChange: (connStatus) => {
      dispatch({ type: 'SET_CONNECTED', payload: connStatus === 'connected' });
    },
    autoStart: true,
  });

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onNavigate: (page) => setCurrentPage(page),
    onFocusFilter: () => {
      // Dispatch event that Kanban component listens to
      const event = new CustomEvent('focusFilter');
      window.dispatchEvent(event);
    },
    onToggleHelp: () => setShowHelp(!showHelp),
    onEscape: () => {
      setShowHelp(false);
      // Close any open panels
      const event = new CustomEvent('closePanel');
      window.dispatchEvent(event);
    },
  });

  // Load initial data
  useEffect(() => {
    const loadData = async () => {
      try {
        dispatch({ type: 'SET_LOADING', payload: true });

        // Always load runtime first to check if configured
        const runtime = await api.runtime().catch(() => null);
        if (runtime) {
          dispatch({ type: 'SET_RUNTIME', payload: runtime });
        }

        // Load main data if configured
        const [project, board, graph, config] = await Promise.all([
          api.project().catch(() => null),
          api.board().catch(() => null),
          api.graph().catch(() => null),
          api.config().catch(() => null),
        ]);

        if (project) dispatch({ type: 'SET_PROJECT', payload: project });
        if (board) dispatch({ type: 'SET_BOARD', payload: board });
        if (graph) dispatch({ type: 'SET_GRAPH', payload: graph });
        if (config) dispatch({ type: 'SET_CONFIG', payload: config });

        // Every request failing means the bridge went away between opening the
        // stream and loading. Say so, rather than leaving the pages sitting on
        // a loading state that will never resolve.
        if (!runtime && !project && !board && !graph && !config) {
          dispatch({
            type: 'SET_ERROR',
            payload: 'The plugin stopped responding. It may have shut down — reconnect to continue.',
          });
          return;
        }

        dispatch({ type: 'SET_ERROR', payload: null });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load data';
        dispatch({ type: 'SET_ERROR', payload: message });
      } finally {
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    };

    if (state.connected) {
      loadData();
    }
  }, [state.connected, dispatch]);

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard />;
      case 'kanban':
        return <Kanban />;
      case 'tasks':
        return <Tasks />;
      case 'graph':
        return <Graph />;
      case 'events':
        return <Events />;
      case 'settings':
        return <Settings />;
      default:
        return <Dashboard />;
    }
  };

  if (!state.connected && status !== 'connecting') {
    return (
      <div className="min-h-screen bg-base-100 flex flex-col">
        <TitleBar status={status} onShowShortcuts={() => setShowHelp(true)} />
        <ConnectionBanner status={status} />
        <div className="flex-1 flex items-center justify-center">
          <ErrorState error="Bridge not connected. Waiting for connection to plugin..." />
        </div>
      </div>
    );
  }

  // Setup screen when the project has never been configured, and also when a
  // chat session explicitly asked to change it: `configured` alone would send a
  // returning user to the dashboard and silently drop the request they made.
  if (state.runtime && (!state.runtime.configured || state.runtime.setup_requested)) {
    return (
      <div className="min-h-screen bg-base-100 flex flex-col">
        <TitleBar status={status} onShowShortcuts={() => setShowHelp(true)} />
        <div className="flex-1">
          <Onboarding
            runtime={state.runtime}
            loading={state.loading}
            error={state.error}
            onComplete={(runtime) => {
              dispatch({ type: 'SET_RUNTIME', payload: runtime });
              // Reload main data after setup
              Promise.all([
                api.project().then((p) => dispatch({ type: 'SET_PROJECT', payload: p })).catch(() => undefined),
                api.board().then((b) => dispatch({ type: 'SET_BOARD', payload: b })).catch(() => undefined),
                api.graph().then((g) => dispatch({ type: 'SET_GRAPH', payload: g })).catch(() => undefined),
                api.config().then((c) => dispatch({ type: 'SET_CONFIG', payload: c })).catch(() => undefined),
              ]);
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base-100 flex flex-col">
      <TitleBar status={status} onShowShortcuts={() => setShowHelp(true)} />
      <ConnectionBanner status={status} />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar currentPage={currentPage} onPageChange={setCurrentPage} />
        <div className="flex-1 flex flex-col overflow-hidden">
          {state.error && <ErrorState error={state.error} />}
          <div className="flex-1 overflow-auto">{renderPage()}</div>
        </div>
      </div>
      <ShortcutOverlay visible={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  );
}
