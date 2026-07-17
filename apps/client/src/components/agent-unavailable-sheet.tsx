import type { AgentUnavailableReason } from '../app-state';
import { BottomSheet, ElectricButton } from '@ai-schedule/ui';
import { Text, View } from '@tarojs/components';

const COPY: Record<AgentUnavailableReason, { body: string; title: string }> = {
  QUOTA: {
    body: '今日智能处理次数已用完，明天可继续。手工待办功能仍可正常使用。',
    title: '明天可继续',
  },
  SERVICE: {
    body: '智能处理暂不可用，请稍后再试。手工待办功能仍可正常使用。',
    title: '智能处理暂不可用',
  },
  VOICE_DEFERRED: {
    body: '语音输入将在后续阶段开放，你可以先使用文字告诉 Agent。',
    title: '语音输入暂不可用',
  },
};

export function AgentUnavailableSheet({
  onClose,
  reason,
}: {
  onClose: () => void;
  reason: AgentUnavailableReason;
}) {
  const copy = COPY[reason];
  return (
    <BottomSheet description={copy.body} title={copy.title}>
      <View className="agentUnavailableNotice">
        <Text>{copy.body}</Text>
      </View>
      <ElectricButton ariaLabel={`关闭${copy.title}`} onClick={onClose}>
        知道了
      </ElectricButton>
    </BottomSheet>
  );
}
