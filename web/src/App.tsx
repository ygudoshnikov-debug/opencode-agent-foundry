import { useReducer } from 'react';
import { FoundryContext, foundryReducer, initialState } from './stores/foundry';
import AppShell from './components/AppShell';

export default function App() {
  const [state, dispatch] = useReducer(foundryReducer, initialState);

  return (
    <FoundryContext.Provider value={{ state, dispatch }}>
      <AppShell />
    </FoundryContext.Provider>
  );
}
