export type AgentRunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'RESULT_PERSISTED'
  | 'SETTLING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'RELEASED';

export type AgentRunRecoveryAction =
  | 'DISPATCH'
  | 'MARK_FAILED'
  | 'NONE'
  | 'RELEASE'
  | 'SETTLE'
  | 'WAIT';

const ALLOWED_TRANSITIONS: Readonly<Record<AgentRunStatus, readonly AgentRunStatus[]>> = {
  QUEUED: ['RUNNING'],
  RUNNING: ['RESULT_PERSISTED', 'FAILED'],
  RESULT_PERSISTED: ['SETTLING'],
  SETTLING: ['SUCCEEDED'],
  SUCCEEDED: [],
  FAILED: ['RELEASED'],
  RELEASED: [],
};

export function assertAgentRunTransition(from: AgentRunStatus, to: AgentRunStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new Error(`非法 Agent Run 状态转换：${from} -> ${to}`);
  }
}

export function canDispatchAgentRun(input: {
  deadlineAt: Date;
  dispatchAttemptedAt: Date | null;
  now: Date;
  status: AgentRunStatus;
}): boolean {
  return (
    input.status === 'QUEUED' &&
    input.dispatchAttemptedAt === null &&
    input.now.getTime() < input.deadlineAt.getTime()
  );
}

export function agentRunRecoveryAction(input: {
  now: Date;
  recoverAfter: Date | null;
  status: AgentRunStatus;
}): AgentRunRecoveryAction {
  switch (input.status) {
    case 'QUEUED':
      return 'DISPATCH';
    case 'RUNNING':
      return input.recoverAfter !== null && input.now.getTime() >= input.recoverAfter.getTime()
        ? 'MARK_FAILED'
        : 'WAIT';
    case 'RESULT_PERSISTED':
    case 'SETTLING':
      return 'SETTLE';
    case 'FAILED':
      return 'RELEASE';
    case 'SUCCEEDED':
    case 'RELEASED':
      return 'NONE';
  }
}
