import {
  createContext,
  type Dispatch,
  type PropsWithChildren,
  useContext,
  useMemo,
  useReducer,
} from 'react';

import {
  appStateReducer,
  createInitialAppState,
  type AppState,
  type AppStateAction,
} from './app-state';

type AppStateContextValue = {
  dispatch: Dispatch<AppStateAction>;
  state: AppState;
};

const AppStateContext = createContext<AppStateContextValue | null>(null);

export function AppStateProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(appStateReducer, undefined, createInitialAppState);
  const value = useMemo(() => ({ dispatch, state }), [state]);

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateContextValue {
  const value = useContext(AppStateContext);
  if (!value) throw new Error('useAppState must be used inside AppStateProvider');
  return value;
}
