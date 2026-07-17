import { Dialog, ElectricButton, NeutralPressButton } from '@ai-schedule/ui';
import { Text, View } from '@tarojs/components';
import { useEffect } from 'react';

export type AgentConversationOption = {
  label: string;
  meta?: string;
  optionId: string;
};

export type AgentConversationMessage = {
  allowFreeText?: boolean;
  answerDisabled?: boolean;
  canGeneratePlan?: boolean;
  content: string;
  id: string;
  options?: readonly AgentConversationOption[];
  proposalId?: string;
  role: 'ASSISTANT' | 'QUESTION' | 'USER';
  version?: number;
};

export type AgentConversationDialogProps = {
  errorMessage?: string;
  focusMessageId?: string;
  messages: readonly AgentConversationMessage[];
  onAnswer: (messageId: string, version: number, optionId: string) => void;
  onClose: () => void;
  onContinue: () => void;
  onFreeText: (messageId: string, version: number) => void;
  onGeneratePlan: (messageId: string, version: number) => void;
  onOpenProposal: (proposalId: string) => void;
  onRetry?: () => void;
  pending: boolean;
};

export function AgentConversationDialog({
  errorMessage,
  focusMessageId,
  messages,
  onAnswer,
  onClose,
  onContinue,
  onFreeText,
  onGeneratePlan,
  onOpenProposal,
  onRetry,
  pending,
}: AgentConversationDialogProps) {
  const focusedMessageAvailable = messages.some((message) => message.id === focusMessageId);
  useEffect(() => {
    if (!focusMessageId || !focusedMessageAvailable || typeof document === 'undefined') {
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>('.agentConversation .agentMessageFocused')
        ?.scrollIntoView({ block: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusMessageId, focusedMessageAvailable]);

  return (
    <Dialog description="确认前不会修改你的待办和项目。" onClose={onClose} title="Agent 对话">
      <View className="agentConversation">
        {messages.map((message) => (
          <View
            className={[
              message.role === 'USER' ? 'agentUserBubble' : 'agentAssistantBubble',
              message.id === focusMessageId ? 'agentMessageFocused' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            key={message.id}
          >
            {message.role !== 'USER' ? <Text className="agentMessageTag">Agent</Text> : null}
            <Text className="agentMessageContent">{message.content}</Text>
            {message.options && message.version ? (
              <View className="agentCandidateList">
                {message.options.map((option) => (
                  <NeutralPressButton
                    role="button"
                    aria-label={`选择${option.label}`}
                    className="agentCandidateRow"
                    disabled={pending || message.answerDisabled === true}
                    key={option.optionId}
                    onClick={() => onAnswer(message.id, message.version ?? 0, option.optionId)}
                    tabIndex={pending || message.answerDisabled === true ? -1 : 0}
                  >
                    <View>
                      <Text className="agentCandidateTitle">{option.label}</Text>
                      {option.meta ? (
                        <Text className="agentCandidateMeta">{option.meta}</Text>
                      ) : null}
                    </View>
                  </NeutralPressButton>
                ))}
                {message.allowFreeText ? (
                  <NeutralPressButton
                    role="button"
                    aria-label="都不是，补充说明"
                    className="agentCandidateRow agentFreeTextAnswer"
                    disabled={pending || message.answerDisabled === true}
                    onClick={() => onFreeText(message.id, message.version ?? 0)}
                    tabIndex={pending || message.answerDisabled === true ? -1 : 0}
                  >
                    <Text className="agentCandidateTitle">都不是，补充说明</Text>
                  </NeutralPressButton>
                ) : null}
              </View>
            ) : null}
            {message.proposalId ? (
              <ElectricButton
                ariaLabel="打开 Agent 操作草稿"
                onClick={() => onOpenProposal(message.proposalId ?? '')}
              >
                查看操作草稿
              </ElectricButton>
            ) : null}
            {message.role === 'ASSISTANT' && message.canGeneratePlan && !message.proposalId ? (
              <ElectricButton
                ariaLabel="根据这条回复生成计划"
                disabled={pending}
                onClick={() => onGeneratePlan(message.id, message.version ?? 0)}
                variant="secondary"
              >
                生成计划
              </ElectricButton>
            ) : null}
          </View>
        ))}
        {pending ? (
          <Text aria-live="polite" className="agentConversationStatus">
            Agent 正在处理…
          </Text>
        ) : null}
        {errorMessage ? (
          <View className="agentConversationError">
            <Text aria-live="polite">{errorMessage}</Text>
            {onRetry ? (
              <ElectricButton ariaLabel="重试读取 Agent 对话" onClick={onRetry} variant="secondary">
                重试
              </ElectricButton>
            ) : null}
          </View>
        ) : null}
        <ElectricButton
          ariaLabel="继续告诉 Agent"
          disabled={pending}
          onClick={onContinue}
          variant="secondary"
        >
          继续对话
        </ElectricButton>
      </View>
    </Dialog>
  );
}
