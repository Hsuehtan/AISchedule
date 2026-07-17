import { randomUUID } from 'node:crypto';

import type { LoadedPointsConfig } from '@ai-schedule/config';
import { IdentityStatus, IdentityType, type DatabaseClient } from '@ai-schedule/db';
import { normalizeUsername } from '@ai-schedule/contracts';

import type { AdminUserLookup } from './admin-password.service.js';

export type AdminPointOperation = 'ADD' | 'SUBTRACT' | 'SET';

export interface AdjustAdminPointsInput {
  readonly lookup: AdminUserLookup;
  readonly operation: AdminPointOperation;
  readonly value: number;
  readonly operator: string;
  readonly reason: string;
  readonly dryRun: boolean;
}

export interface AdjustAdminPointsResult {
  readonly userId: string;
  readonly operation: AdminPointOperation;
  readonly pointsDelta: number;
  readonly balanceBefore: number;
  readonly balanceAfter: number;
  readonly reservedPoints: number;
  readonly dryRun: boolean;
  readonly transactionId: string | null;
}

export interface AdminPointHistoryEntry {
  readonly transactionId: string;
  readonly type: string;
  readonly status: string;
  readonly pointsDelta: number;
  readonly balanceBefore: number | null;
  readonly balanceAfter: number | null;
  readonly reasonCode: string;
  readonly operator: string | null;
  readonly reason: string | null;
  readonly createdAt: Date;
}

export class AdminPointsService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly config: LoadedPointsConfig,
  ) {}

  async adjust(input: AdjustAdminPointsInput): Promise<AdjustAdminPointsResult> {
    validateAdjustment(input);
    const userId = await this.resolveUserId(input.lookup);
    if (!userId) throw new AdminPointsUserNotFoundError();

    return this.database.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "users"
        WHERE "id" = ${userId}::uuid
        FOR NO KEY UPDATE
      `;
      if (rows.length !== 1) throw new AdminPointsUserNotFoundError();
      const user = await transaction.user.findUniqueOrThrow({ where: { id: userId } });
      const pending = await transaction.aiPointTransaction.aggregate({
        where: {
          userId,
          type: 'DEBIT',
          status: 'PENDING',
        },
        _sum: { pointsDelta: true },
      });
      const reservedPoints = -(pending._sum.pointsDelta ?? 0);
      const balanceAfter = targetBalance(user.aiPoints, input.operation, input.value);
      const pointsDelta = balanceAfter - user.aiPoints;
      if (balanceAfter > 2_147_483_647) {
        throw new Error('adjusted point balance exceeds the PostgreSQL integer range');
      }
      if (balanceAfter < 0 || balanceAfter < reservedPoints) {
        throw new AdminPointsReservedBalanceError();
      }

      const result = {
        userId,
        operation: input.operation,
        pointsDelta,
        balanceBefore: user.aiPoints,
        balanceAfter,
        reservedPoints,
        dryRun: input.dryRun,
        transactionId: null,
      } satisfies AdjustAdminPointsResult;
      if (input.dryRun) return result;

      const now = new Date();
      const transactionId = randomUUID();
      await transaction.user.update({ where: { id: userId }, data: { aiPoints: balanceAfter } });
      await transaction.aiPointTransaction.create({
        data: {
          id: transactionId,
          userId,
          type: 'ADJUSTMENT',
          pointsDelta,
          status: 'SUCCEEDED',
          idempotencyKey: `admin:${transactionId}`,
          reasonCode: 'admin_adjustment',
          operator: input.operator.trim(),
          reason: input.reason.trim(),
          configVersion: this.config.version,
          configHash: this.config.hash,
          unitCost: Math.abs(pointsDelta),
          balanceBefore: user.aiPoints,
          balanceAfter,
          settledAt: now,
        },
      });
      await transaction.adminAuditEvent.create({
        data: {
          operator: input.operator.trim(),
          actionType: `POINTS_${input.operation}`,
          targetUserId: userId,
          reason: input.reason.trim(),
          requestPayload: {
            lookupType: 'userId' in input.lookup ? 'USER_ID' : 'USERNAME',
            operation: input.operation,
            value: input.value,
          },
          resultPayload: { transactionId, pointsDelta, balanceBefore: user.aiPoints, balanceAfter },
        },
      });

      return { ...result, transactionId };
    });
  }

  async history(lookup: AdminUserLookup, limit: number): Promise<AdminPointHistoryEntry[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new Error('history limit must be between 1 and 200');
    }
    const userId = await this.resolveUserId(lookup);
    if (!userId) throw new AdminPointsUserNotFoundError();
    const transactions = await this.database.aiPointTransaction.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return transactions.map((transaction) => ({
      transactionId: transaction.id,
      type: transaction.type,
      status: transaction.status,
      pointsDelta: transaction.pointsDelta,
      balanceBefore: transaction.balanceBefore,
      balanceAfter: transaction.balanceAfter,
      reasonCode: transaction.reasonCode,
      operator: transaction.operator,
      reason: transaction.reason,
      createdAt: transaction.createdAt,
    }));
  }

  private async resolveUserId(lookup: AdminUserLookup): Promise<string | null> {
    if ('userId' in lookup) {
      const user = await this.database.user.findUnique({
        where: { id: lookup.userId },
        select: { id: true },
      });
      return user?.id ?? null;
    }
    const identity = await this.database.userIdentity.findUnique({
      where: {
        type_identifierNormalized: {
          type: IdentityType.USERNAME,
          identifierNormalized: normalizeUsername(lookup.username),
        },
      },
      select: { userId: true, status: true },
    });
    return identity?.status === IdentityStatus.ACTIVE ? identity.userId : null;
  }
}

function targetBalance(current: number, operation: AdminPointOperation, value: number): number {
  switch (operation) {
    case 'ADD':
      return current + value;
    case 'SUBTRACT':
      return current - value;
    case 'SET':
      return value;
  }
}

function validateAdjustment(input: AdjustAdminPointsInput): void {
  if (!Number.isSafeInteger(input.value) || input.value < 0) {
    throw new Error('point adjustment value must be a non-negative safe integer');
  }
  if (input.value > 2_147_483_647) {
    throw new Error('point adjustment value exceeds the PostgreSQL integer range');
  }
  if (input.operation !== 'SET' && input.value === 0) {
    throw new Error('add/subtract value must be positive');
  }
  const operator = input.operator.trim();
  const reason = input.reason.trim();
  if (!operator || operator.length > 128) throw new Error('operator is required (max 128)');
  if (!reason || reason.length > 500) throw new Error('reason is required (max 500)');
}

export class AdminPointsUserNotFoundError extends Error {
  constructor() {
    super('未找到目标用户');
    this.name = 'AdminPointsUserNotFoundError';
  }
}

export class AdminPointsReservedBalanceError extends Error {
  constructor() {
    super('调整后余额不足以覆盖有效预留');
    this.name = 'AdminPointsReservedBalanceError';
  }
}
