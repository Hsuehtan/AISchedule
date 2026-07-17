import type { AgentMessage } from '@ai-schedule/contracts';

import type {
  AgentConversationMessage,
  AgentConversationOption,
} from './components/agent-conversation-dialog';

function presentQuestionOption(
  option: Extract<AgentMessage, { messageType: 'QUESTION' }>['content']['options'][number],
): AgentConversationOption {
  const meta = option.description ?? option.context?.projectName ?? undefined;
  return {
    label: option.label,
    optionId: option.id,
    ...(meta ? { meta } : {}),
  };
}

export function presentAgentMessages(
  messages: readonly AgentMessage[],
): AgentConversationMessage[] {
  return messages.map((message) => {
    switch (message.messageType) {
      case 'USER_INPUT':
        return {
          content: message.content.text,
          id: message.id,
          role: 'USER',
        };
      case 'AI_REPLY':
        return {
          canGeneratePlan: message.content.canGeneratePlan,
          content: message.content.text,
          id: message.id,
          role: 'ASSISTANT',
          version: message.version,
        };
      case 'QUESTION':
        return {
          allowFreeText: message.content.allowFreeText && message.interactionStatus === 'PENDING',
          answerDisabled: message.interactionStatus !== 'PENDING',
          content: message.content.prompt,
          id: message.id,
          options: message.content.options
            .filter(
              (option) =>
                !message.content.allowFreeText ||
                (option.id.toLowerCase() !== 'none' && option.label !== '都不是'),
            )
            .map(presentQuestionOption),
          role: 'QUESTION',
          version: message.version,
        };
      case 'ACTION_CONFIRM':
        return {
          content: message.content.summary,
          id: message.id,
          proposalId: message.proposalId,
          role: 'ASSISTANT',
        };
    }
  });
}
