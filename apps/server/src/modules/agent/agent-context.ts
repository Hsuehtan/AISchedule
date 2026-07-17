import { randomBytes } from 'node:crypto';

export type AgentContextMessage = {
  content: string;
  role: 'ASSISTANT' | 'USER';
};

const MAX_CONTEXT_MESSAGES = 20;
const MAX_CONTEXT_BYTES = 12 * 1024;
const MAX_TASK_CANDIDATES = 50;
const MAX_PROJECT_CANDIDATES = 30;

export function selectBoundedAgentMessages(
  messages: readonly AgentContextMessage[],
): AgentContextMessage[] {
  const selected: AgentContextMessage[] = [];
  let selectedBytes = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (selected.length === MAX_CONTEXT_MESSAGES) break;
    const message = messages[index];
    if (!message) continue;
    const messageBytes = new TextEncoder().encode(message.content).byteLength;
    if (selected.length === 0 && messageBytes > MAX_CONTEXT_BYTES) {
      throw new AgentContextLimitError('最新消息超过 Agent 上下文 12 KiB 限制');
    }
    if (selectedBytes + messageBytes > MAX_CONTEXT_BYTES) break;
    selected.unshift(message);
    selectedBytes += messageBytes;
  }

  return selected;
}

export function validateCandidateBudget(input: { projectCount: number; taskCount: number }): void {
  if (
    !Number.isInteger(input.taskCount) ||
    input.taskCount < 0 ||
    input.taskCount > MAX_TASK_CANDIDATES
  ) {
    throw new AgentContextLimitError(`待办候选不能超过 ${MAX_TASK_CANDIDATES} 个`);
  }
  if (
    !Number.isInteger(input.projectCount) ||
    input.projectCount < 0 ||
    input.projectCount > MAX_PROJECT_CANDIDATES
  ) {
    throw new AgentContextLimitError(`项目候选不能超过 ${MAX_PROJECT_CANDIDATES} 个`);
  }
}

export function createCandidateReference(): string {
  return `cand_${randomBytes(16).toString('hex')}`;
}

export function createOptionId(): string {
  return `opt_${randomBytes(8).toString('hex')}`;
}

export class AgentContextLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentContextLimitError';
  }
}
