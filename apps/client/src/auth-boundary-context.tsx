import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';

import { useAppState } from './app-state-context';
import { queryClient } from './app-runtime';
import { replaceAppRoute } from './platform-router';
import { unauthorizedChannel } from './unauthorized-channel';

type AuthBoundaryValue = {
  markAuthenticated: () => void;
  resolveSession: (authenticated: boolean) => void;
  transitionToGuest: () => Promise<void>;
};

const AuthBoundaryContext = createContext<AuthBoundaryValue | null>(null);

export function AuthBoundaryProvider({ children }: PropsWithChildren) {
  const { dispatch } = useAppState();
  const guestTransition = useRef<Promise<void> | null>(null);
  const resolveSession = useCallback(
    (authenticated: boolean) =>
      dispatch({
        type: 'SESSION_RESOLVED',
        session: authenticated ? 'authenticated' : 'guest',
      }),
    [dispatch],
  );
  const markAuthenticated = useCallback(() => resolveSession(true), [resolveSession]);
  const transitionToGuest = useCallback(async () => {
    if (guestTransition.current) return guestTransition.current;

    const transition = (async () => {
      await queryClient.cancelQueries();
      // Disable account-scoped observers before clearing their cache. Taro may resolve
      // reLaunch while the previous page is still mounted, so navigation alone is not a
      // reliable boundary against a post-logout refetch.
      dispatch({ type: 'LOGOUT' });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      queryClient.clear();
      await replaceAppRoute('login');
    })();
    guestTransition.current = transition;
    try {
      await transition;
    } finally {
      if (guestTransition.current === transition) guestTransition.current = null;
    }
  }, [dispatch]);

  useEffect(
    () =>
      unauthorizedChannel.subscribe(() => {
        void transitionToGuest();
      }),
    [transitionToGuest],
  );

  const value = useMemo(
    () => ({ markAuthenticated, resolveSession, transitionToGuest }),
    [markAuthenticated, resolveSession, transitionToGuest],
  );

  return <AuthBoundaryContext.Provider value={value}>{children}</AuthBoundaryContext.Provider>;
}

export function useAuthBoundary(): AuthBoundaryValue {
  const value = useContext(AuthBoundaryContext);
  if (!value) throw new Error('useAuthBoundary must be used inside AuthBoundaryProvider');
  return value;
}
