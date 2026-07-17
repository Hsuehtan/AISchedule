import { Dialog, ElectricButton, NeutralPressButton } from '@ai-schedule/ui';
import { Text, View } from '@tarojs/components';

export type AgentConversationOption = {
  label: string;
  meta?: string;
  optionId: string;
};

export type AgentConversationMessage = {
  content: string;
  id: string;
  options?: readonly AgentConversationOption[];
  proposalId?: string;
  role: 'ASSISTANT' | 'QUESTION' | 'USER';
  version?: number;
};

export type AgentConversationDialogProps = {
  messages: readonly AgentConversationMessage[];
  onAnswer: (messageId: string, version: number, optionId: string) => void;
  onClose: () => void;
  onGeneratePlan: (messageId: string) => void;
  onOpenProposal: (proposalId: string) => void;
};

export function AgentConversationDialog({
  messages,
  onAnswer,
  onClose,
  onGeneratePlan,
  onOpenProposal,
}: AgentConversationDialogProps) {
  return (
    <Dialog description="确认前不会修改你的待办和项目。" onClose={onClose} title="Agent 对话">
      <View className="agentConversation">
        {messages.map((message) => (
          <View
            className={message.role === 'USER' ? 'agentUserBubble' : 'agentAssistantBubble'}
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
                    key={option.optionId}
                    onClick={() => onAnswer(message.id, message.version ?? 0, option.optionId)}
                    tabIndex={0}
                  >
                    <View>
                      <Text className="agentCandidateTitle">{option.label}</Text>
                      {option.meta ? (
                        <Text className="agentCandidateMeta">{option.meta}</Text>
                      ) : null}
                    </View>
                  </NeutralPressButton>
                ))}
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
            {message.role === 'ASSISTANT' && !message.proposalId ? (
              <ElectricButton
                ariaLabel="根据这条回复生成计划"
                onClick={() => onGeneratePlan(message.id)}
                variant="secondary"
              >
                生成计划
              </ElectricButton>
            ) : null}
          </View>
        ))}
      </View>
    </Dialog>
  );
}
