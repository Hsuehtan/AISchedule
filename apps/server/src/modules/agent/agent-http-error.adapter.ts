import {
  agentPublicErrorCodeSchema,
  agentPublicErrorHttpStatus,
  type AgentPublicErrorCode,
} from '@ai-schedule/contracts';
import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';

import { ApiHttpException } from '../../platform/http/api-http.exception.js';

const publicDetailsSchema = z
  .object({
    retryAfterMs: z.number().int().positive().optional(),
    currentVersion: z.number().int().positive().optional(),
    canRetryTomorrow: z.boolean().optional(),
  })
  .strict();

const PUBLIC_ERROR_MESSAGES: Readonly<Record<AgentPublicErrorCode, string>> = {
  AGENT_DAILY_QUOTA_EXHAUSTED: '今天的智能处理额度已用完',
  AGENT_POINTS_INSUFFICIENT: '今天的智能处理额度已用完',
  AGENT_CAPABILITY_DISABLED: '智能处理暂不可用',
  AGENT_SERVICE_UNAVAILABLE: '智能处理暂不可用',
  AGENT_REQUEST_NOT_FOUND: '智能请求不存在',
  AGENT_REQUEST_CONFLICT: '智能请求状态已发生变化，请刷新后重试',
  AGENT_REQUEST_EXPIRED: '智能请求已过期',
  AGENT_RESULT_UNAVAILABLE: '智能处理暂不可用',
  AGENT_MESSAGE_VERSION_CONFLICT: '消息已发生变化，请刷新后重试',
  ACTION_PROPOSAL_NOT_FOUND: '操作提案不存在',
  ACTION_PROPOSAL_VERSION_CONFLICT: '操作提案已发生变化，请刷新后重试',
  ACTION_PROPOSAL_NOT_EXECUTABLE: '当前状态下无法执行该操作',
  ACTION_TARGET_VERSION_CONFLICT: '目标待办已发生变化，请刷新后重试',
  ACTION_EXECUTION_FAILED: '操作执行失败，请检查后重试',
};

export async function callAgentApplication<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw toPublicAgentException(error);
  }
}

function toPublicAgentException(error: unknown): ApiHttpException {
  if (error instanceof ApiHttpException) {
    const code = agentPublicErrorCodeSchema.safeParse(error.code);
    if (code.success) {
      const details = publicDetailsSchema.safeParse(error.details);
      return new ApiHttpException(
        agentPublicErrorHttpStatus[code.data],
        code.data,
        PUBLIC_ERROR_MESSAGES[code.data],
        details.success ? details.data : {},
      );
    }
  }

  return new ApiHttpException(
    HttpStatus.SERVICE_UNAVAILABLE,
    'AGENT_SERVICE_UNAVAILABLE',
    PUBLIC_ERROR_MESSAGES.AGENT_SERVICE_UNAVAILABLE,
  );
}
