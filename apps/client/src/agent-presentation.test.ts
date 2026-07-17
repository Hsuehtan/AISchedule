import { agentMessageSchema, type AgentMessage } from '@ai-schedule/contracts';
import { describe, expect, it } from 'vitest';

import { presentAgentMessages } from './agent-presentation';

const base = {
  id: '018f47be-1972-7d58-9d67-4ddc5eb78a65',
  conversationId: '018f47be-1972-7d58-9d67-4ddc5eb78a63',
  replyToId: null,
  aiRequestId: '018f47be-1972-7d58-9d67-4ddc5eb78a64',
  version: 2,
  createdAt: '2026-07-17T12:00:00.000Z',
};

function message(value: unknown): AgentMessage {
  return agentMessageSchema.parse(value);
}

describe('Agent message presentation', () => {
  it('maps every persisted public message variant without exposing internal ids', () => {
    const messages = [
      message({
        ...base,
        role: 'USER',
        messageType: 'USER_INPUT',
        inputMode: 'TEXT',
        content: { type: 'USER_INPUT', text: '周报处理一下' },
        proposalId: null,
        interactionStatus: null,
      }),
      message({
        ...base,
        id: '018f47be-1972-7d58-9d67-4ddc5eb78a66',
        role: 'ASSISTANT',
        messageType: 'AI_REPLY',
        inputMode: 'SYSTEM',
        content: { type: 'AI_REPLY', text: '<b>先确认范围</b>', canGeneratePlan: true },
        proposalId: null,
        interactionStatus: null,
      }),
      message({
        ...base,
        id: '018f47be-1972-7d58-9d67-4ddc5eb78a67',
        role: 'ASSISTANT',
        messageType: 'QUESTION',
        inputMode: 'SYSTEM',
        content: {
          type: 'QUESTION',
          questionKind: 'CANDIDATES',
          prompt: '你指的是哪一项？',
          options: [
            { id: 'opt_a', label: '写周报', context: { projectName: '工作' } },
            { id: 'none', label: '都不是' },
          ],
          allowFreeText: true,
          nextStep: 'AGENT_STANDARD_TURN',
        },
        proposalId: null,
        interactionStatus: 'PENDING',
      }),
      message({
        ...base,
        id: '018f47be-1972-7d58-9d67-4ddc5eb78a68',
        role: 'ASSISTANT',
        messageType: 'ACTION_CONFIRM',
        inputMode: 'SYSTEM',
        content: { type: 'ACTION_CONFIRM', title: '准备修改', summary: '将周报设为完成' },
        proposalId: '018f47be-1972-7d58-9d67-4ddc5eb78a69',
        interactionStatus: null,
      }),
    ];

    expect(presentAgentMessages(messages)).toEqual([
      { content: '周报处理一下', id: messages[0]?.id, role: 'USER' },
      {
        canGeneratePlan: true,
        content: '<b>先确认范围</b>',
        id: messages[1]?.id,
        role: 'ASSISTANT',
      },
      {
        content: '你指的是哪一项？',
        id: messages[2]?.id,
        options: [
          { label: '写周报', meta: '工作', optionId: 'opt_a' },
          { label: '都不是', optionId: 'none' },
        ],
        role: 'QUESTION',
        version: 2,
      },
      {
        content: '将周报设为完成',
        id: messages[3]?.id,
        proposalId: '018f47be-1972-7d58-9d67-4ddc5eb78a69',
        role: 'ASSISTANT',
      },
    ]);
    expect(JSON.stringify(presentAgentMessages(messages))).not.toContain('aiRequestId');
  });
});
