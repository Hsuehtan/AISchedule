import type { PropsWithChildren } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';

import { queryClient } from './app-runtime';
import { AppStateProvider } from './app-state-context';
import { AuthBoundaryProvider } from './auth-boundary-context';

import './app.scss';

export default function App({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      <AppStateProvider>
        <AuthBoundaryProvider>{children}</AuthBoundaryProvider>
      </AppStateProvider>
    </QueryClientProvider>
  );
}
