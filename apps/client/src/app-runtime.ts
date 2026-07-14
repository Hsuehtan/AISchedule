import { QueryClient } from '@tanstack/react-query';

import { ApiClient } from './api-client';
import { ScheduleApi } from './schedule-api';
import { taroTransport } from './taro-transport';
import { unauthorizedChannel } from './unauthorized-channel';

export const queryClient = new QueryClient({
  defaultOptions: {
    mutations: { retry: false },
    queries: { refetchOnWindowFocus: true, retry: 1, staleTime: 15_000 },
  },
});

const apiClient = new ApiClient({
  baseUrl: '/api/v1',
  onUnauthorized: () => unauthorizedChannel.notify(),
  transport: taroTransport,
});

export const scheduleApi = new ScheduleApi(apiClient);
