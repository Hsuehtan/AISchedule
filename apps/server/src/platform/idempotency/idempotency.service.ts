import { createHash, randomUUID } from 'node:crypto';

import type { Prisma } from '@ai-schedule/db';
import { Inject, Injectable } from '@nestjs/common';

import { DatabaseService } from '../database/database.service.js';
import { ApiHttpException } from '../http/api-http.exception.js';

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;
const IDEMPOTENCY_CLEANUP_BATCH_SIZE = 100;

type JsonPrimitive = boolean | null | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
    .join(',')}}`;
}

function requestHash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function asJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function requireIdempotencyKey(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    throw new ApiHttpException(428, 'IDEMPOTENCY_KEY_REQUIRED', '缺少 Idempotency-Key');
  }
  if (value.length > 128) {
    throw new ApiHttpException(
      400,
      'IDEMPOTENCY_KEY_INVALID',
      'Idempotency-Key 最多支持 128 个字符',
    );
  }
  return value;
}

export type IdempotencyOperationContext = {
  operationId: string;
  transaction: Prisma.TransactionClient;
};

@Injectable()
export class IdempotencyService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async execute<T extends JsonValue>(options: {
    userId: string;
    scope: string;
    key: string;
    request: unknown;
    responseStatus: number | ((response: T) => number);
    operation: (context: IdempotencyOperationContext) => Promise<T>;
  }): Promise<T> {
    const hash = requestHash(options.request);
    const claimedAt = new Date();
    const expiresAt = new Date(claimedAt.getTime() + IDEMPOTENCY_TTL_MS);

    await this.cleanupExpired(claimedAt);

    return this.database.client.$transaction(async (transaction) => {
      await transaction.idempotencyRecord.deleteMany({
        where: {
          userId: options.userId,
          scope: options.scope,
          key: options.key,
          expiresAt: { lte: claimedAt },
        },
      });

      const claim = await transaction.idempotencyRecord.createMany({
        data: {
          userId: options.userId,
          scope: options.scope,
          key: options.key,
          requestHash: hash,
          expiresAt,
        },
        skipDuplicates: true,
      });

      if (claim.count === 0) {
        const existing = await transaction.idempotencyRecord.findUniqueOrThrow({
          where: {
            userId_scope_key: {
              userId: options.userId,
              scope: options.scope,
              key: options.key,
            },
          },
        });
        if (existing.requestHash !== hash) {
          throw new ApiHttpException(
            409,
            'IDEMPOTENCY_KEY_REUSED',
            '该 Idempotency-Key 已用于不同请求',
          );
        }
        if (existing.responseSnapshot === null) {
          throw new ApiHttpException(
            409,
            'IDEMPOTENCY_REQUEST_IN_PROGRESS',
            '同一请求正在处理中，请稍后重试',
          );
        }
        return existing.responseSnapshot as T;
      }

      const response = await options.operation({
        operationId: randomUUID(),
        transaction,
      });
      await transaction.idempotencyRecord.update({
        where: {
          userId_scope_key: {
            userId: options.userId,
            scope: options.scope,
            key: options.key,
          },
        },
        data: {
          responseStatus:
            typeof options.responseStatus === 'function'
              ? options.responseStatus(response)
              : options.responseStatus,
          responseSnapshot: asJsonValue(response),
        },
      });
      return response;
    });
  }

  private async cleanupExpired(now: Date): Promise<void> {
    const expired = await this.database.client.idempotencyRecord.findMany({
      where: { expiresAt: { lte: now } },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
      take: IDEMPOTENCY_CLEANUP_BATCH_SIZE,
    });
    if (expired.length === 0) return;

    await this.database.client.idempotencyRecord.deleteMany({
      where: { id: { in: expired.map(({ id }) => id) }, expiresAt: { lte: now } },
    });
  }
}
