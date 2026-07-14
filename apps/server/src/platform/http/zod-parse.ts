import type { z } from 'zod';

import { ApiHttpException } from './api-http.exception.js';

export function parseRequest<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
): z.output<TSchema> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new ApiHttpException(400, 'VALIDATION_ERROR', '请求参数不合法', {
    issues: parsed.error.issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      path: issue.path.map(String),
    })),
  });
}
