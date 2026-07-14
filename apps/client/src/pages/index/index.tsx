import { AppShell, ElectricButton } from '@ai-schedule/ui';
import { useQuery } from '@tanstack/react-query';
import { Text, View } from '@tarojs/components';
import { useEffect } from 'react';

import { scheduleApi } from '../../app-runtime';
import { useAuthBoundary } from '../../auth-boundary-context';
import { replaceAppRoute } from '../../platform-router';
import '../../components/production-screens.scss';

export default function IndexPage() {
  const { resolveSession } = useAuthBoundary();
  const session = useQuery({
    queryFn: () => scheduleApi.session(),
    queryKey: ['auth', 'session'],
    retry: 1,
  });

  useEffect(() => {
    if (!session.data) return;
    resolveSession(session.data.authenticated);
    void replaceAppRoute(session.data.authenticated ? 'tasks' : 'login');
  }, [resolveSession, session.data]);

  return (
    <AppShell className="bootScreen">
      <View className="bootCard" aria-busy={session.isPending ? 'true' : 'false'}>
        <Text className="bootTitle">整理今天</Text>
        <Text className="bootCopy">
          {session.isError ? '连接服务失败，你可以重试。' : '正在恢复你的待办…'}
        </Text>
        {session.isError ? (
          <ElectricButton ariaLabel="重试恢复会话" onClick={() => void session.refetch()}>
            重试
          </ElectricButton>
        ) : null}
      </View>
    </AppShell>
  );
}
