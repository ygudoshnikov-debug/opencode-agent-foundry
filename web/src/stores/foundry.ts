/**
 * Hand-rolled state store using context + reducer.
 * NO external state management library (redux/zustand) unless needed.
 */

import type { Board, ConfigView, GraphView, ProjectSummary, FoundryEvent, Task, RuntimeView } from '@foundry/protocol';
import { createContext, useCallback, useContext, useReducer } from 'react';

export interface FoundryState {
  connected: boolean;
  loading: boolean;
  error: string | null;
  project: ProjectSummary | null;
  board: Board | null;
  graph: GraphView | null;
  config: ConfigView | null;
  runtime: RuntimeView | null;
  taskDetail: Task | null;
  events: FoundryEvent[];
  eventsTotal: number;
}

export const initialState: FoundryState = {
  connected: false,
  loading: false,
  error: null,
  project: null,
  board: null,
  graph: null,
  config: null,
  runtime: null,
  taskDetail: null,
  events: [],
  eventsTotal: 0,
};

export type FoundryAction =
  | { type: 'SET_CONNECTED'; payload: boolean }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_PROJECT'; payload: ProjectSummary }
  | { type: 'SET_BOARD'; payload: Board }
  | { type: 'SET_GRAPH'; payload: GraphView }
  | { type: 'SET_CONFIG'; payload: ConfigView }
  | { type: 'SET_RUNTIME'; payload: RuntimeView }
  | { type: 'SET_TASK_DETAIL'; payload: Task | null }
  | { type: 'SET_EVENTS'; payload: FoundryEvent[] }
  | { type: 'ADD_EVENT'; payload: FoundryEvent }
  | { type: 'RESET' };

export function foundryReducer(state: FoundryState, action: FoundryAction): FoundryState {
  switch (action.type) {
    case 'SET_CONNECTED':
      return { ...state, connected: action.payload };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'SET_PROJECT':
      return { ...state, project: action.payload };
    case 'SET_BOARD':
      return { ...state, board: action.payload };
    case 'SET_GRAPH':
      return { ...state, graph: action.payload };
    case 'SET_CONFIG':
      return { ...state, config: action.payload };
    case 'SET_RUNTIME':
      return { ...state, runtime: action.payload };
    case 'SET_TASK_DETAIL':
      return { ...state, taskDetail: action.payload };
    case 'SET_EVENTS':
      return {
        ...state,
        events: action.payload,
        eventsTotal: action.payload.length,
      };
    case 'ADD_EVENT':
      return {
        ...state,
        events: [action.payload, ...state.events],
        eventsTotal: state.eventsTotal + 1,
      };
    case 'RESET':
      return initialState;
    default:
      return state;
  }
}

export const FoundryContext = createContext<{
  state: FoundryState;
  dispatch: (action: FoundryAction) => void;
} | null>(null);

export function useFoundryStore() {
  const context = useContext(FoundryContext);
  if (!context) {
    throw new Error('useFoundryStore must be used within FoundryProvider');
  }
  return context;
}
