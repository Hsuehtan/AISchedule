import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { AiPointTransaction, Prisma } from '@ai-schedule/db';

import {
  DatabaseUnitOfWork,
  type TransactionScope,
} from '../../../platform/database/unit-of-work.js';
import {
  RUNTIME_CONFIGURATION,
  type RuntimeConfiguration,
} from '../../../platform/runtime-configuration.js';
import {
  AiCapabilityUnavailableError,
  AiPointAccountNotFoundError,
  AiPointInvariantError,
  AiPointReservationExpiredError,
  AiPointReservationNotFoundError,
  AiPointReservationTerminalError,
  AiPointResultReferenceError,
  InsufficientAiPointsError,
  type AiPointsPort,
  type AiResultReference,
  type GrantReceipt,
  type PointRefundReceipt,
  type PointReleaseReceipt,
  type PointSettlementReceipt,
  type ReservationReceipt,
  type ReserveAiPointsInput,
} from './ai-points.port.js';
import { localDateAt, localDateValue } from './local-date.js';

const RESERVATION_LEASE_MILLISECONDS = 5 * 60 * 1_000;

@Injectable()
export class AiPointsService implements AiPointsPort {
  constructor(
    @Inject(DatabaseUnitOfWork) private readonly unitOfWork: DatabaseUnitOfWork,
    @Inject(RUNTIME_CONFIGURATION) private readonly runtime: RuntimeConfiguration,
  ) {}

  async grantNewUser(scope: TransactionScope, userId: string): Promise<GrantReceipt> {
    const transaction = this.unitOfWork.clientFor(scope);
    const user = await this.lockUser(transaction, userId);
    const existing = await transaction.aiPointTransaction.findFirst({
      where: {
        userId,
        OR: [
          { reasonCode: 'new_user_initial_grant' },
          { reasonCode: 'NEW_USER_INITIAL_GRANT' },
          { type: 'NEW_USER_GRANT' },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return this.grantReceipt(existing);
    if (user.aiPoints !== 0) throw new AiPointInvariantError();

    const rule = this.runtime.points.value.grants.newUser;
    const balanceAfter = user.aiPoints + rule.points;
    const transactionId = randomUUID();
    await transaction.user.update({
      where: { id: userId },
      data: { aiPoints: balanceAfter },
    });
    const created = await transaction.aiPointTransaction.create({
      data: {
        id: transactionId,
        userId,
        type: 'GRANT',
        pointsDelta: rule.points,
        status: 'SUCCEEDED',
        idempotencyKey: stableKey('new-user', userId),
        reasonCode: 'new_user_initial_grant',
        grantRuleVersion: rule.ruleVersion,
        configVersion: this.runtime.points.version,
        configHash: this.runtime.points.hash,
        unitCost: rule.points,
        balanceBefore: user.aiPoints,
        balanceAfter,
        settledAt: new Date(),
      },
    });
    return this.grantReceipt(created);
  }

  async topUpDaily(scope: TransactionScope, userId: string): Promise<GrantReceipt | null> {
    const transaction = this.unitOfWork.clientFor(scope);
    const user = await this.lockUser(transaction, userId);
    return this.topUpDailyLocked(transaction, user, new Date());
  }

  async reserve(scope: TransactionScope, input: ReserveAiPointsInput): Promise<ReservationReceipt> {
    validateRequestId(input.requestId);
    const transaction = this.unitOfWork.clientFor(scope);
    let user = await this.lockUser(transaction, input.userId);
    await this.topUpDailyLocked(transaction, user, new Date());
    user = await transaction.user.findUniqueOrThrow({ where: { id: input.userId } });

    const capability = await transaction.aiCapability.findFirst({
      where: {
        capabilityCode: input.capabilityCode,
        endpointCode: input.endpointCode,
        status: 'ACTIVE',
      },
    });
    if (!capability?.callsModelApi) throw new AiCapabilityUnavailableError();

    const existing = await transaction.aiPointTransaction.findFirst({
      where: {
        userId: input.userId,
        requestId: input.requestId,
        capabilityCode: input.capabilityCode,
        type: 'DEBIT',
      },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) {
      if (existing.endpointCode !== input.endpointCode) throw new AiPointInvariantError();
      return this.reservationReceipt(transaction, user.aiPoints, existing, new Date());
    }

    const now = new Date();
    const reserved = await this.activeReservationTotal(transaction, input.userId);
    const availablePoints = user.aiPoints - reserved;
    if (availablePoints < capability.pointsCost) throw new InsufficientAiPointsError();

    const reservationId = randomUUID();
    const expiresAt = new Date(now.getTime() + RESERVATION_LEASE_MILLISECONDS);
    const created = await transaction.aiPointTransaction.create({
      data: {
        userId: input.userId,
        type: 'DEBIT',
        pointsDelta: -capability.pointsCost,
        status: 'PENDING',
        requestId: input.requestId,
        idempotencyKey: stableKey('debit', input.userId, input.requestId, input.capabilityCode),
        reservationId,
        capabilityId: capability.id,
        capabilityCode: capability.capabilityCode,
        endpointCode: capability.endpointCode,
        costRuleVersion: capability.costRuleVersion,
        reasonCode: 'ai_request_reservation',
        configVersion: this.runtime.points.version,
        configHash: this.runtime.points.hash,
        unitCost: capability.pointsCost,
        reservedAt: now,
        reservationExpiresAt: expiresAt,
      },
    });

    return {
      transactionId: created.id,
      reservationId,
      status: 'PENDING',
      pointsCost: capability.pointsCost,
      availablePoints: availablePoints - capability.pointsCost,
      expiresAt,
    };
  }

  async extendLease(
    scope: TransactionScope,
    input: { readonly userId: string; readonly reservationId: string; readonly expiresAt: Date },
  ): Promise<ReservationReceipt> {
    const transaction = this.unitOfWork.clientFor(scope);
    const now = new Date();
    const user = await this.lockUser(transaction, input.userId);
    const reservation = await this.findReservation(transaction, input.userId, input.reservationId);
    if (reservation.status !== 'PENDING') {
      if (reservation.status === 'SUCCEEDED') {
        return this.reservationReceipt(transaction, user.aiPoints, reservation, now);
      }
      throw new AiPointReservationTerminalError();
    }
    if (!reservation.reservationExpiresAt || reservation.reservationExpiresAt <= now) {
      throw new AiPointReservationExpiredError();
    }
    if (input.expiresAt <= reservation.reservationExpiresAt) {
      return this.reservationReceipt(transaction, user.aiPoints, reservation, now);
    }

    const claimed = await transaction.aiPointTransaction.updateMany({
      where: {
        id: reservation.id,
        status: 'PENDING',
        reservationExpiresAt: { gt: now },
      },
      data: { reservationExpiresAt: input.expiresAt },
    });
    if (claimed.count !== 1) {
      const current = await this.findReservation(transaction, input.userId, input.reservationId);
      if (current.status !== 'PENDING') throw new AiPointReservationTerminalError();
      throw new AiPointReservationExpiredError();
    }
    const updated = await this.findReservation(transaction, input.userId, input.reservationId);
    return this.reservationReceipt(transaction, user.aiPoints, updated, now);
  }

  async settle(
    scope: TransactionScope,
    input: {
      readonly userId: string;
      readonly reservationId: string;
      readonly result: AiResultReference;
    },
  ): Promise<PointSettlementReceipt> {
    const transaction = this.unitOfWork.clientFor(scope);
    const user = await this.lockUser(transaction, input.userId);
    const reservation = await this.findReservation(transaction, input.userId, input.reservationId);
    if (reservation.status === 'SUCCEEDED') {
      this.assertSameResult(reservation, input.result);
      if (reservation.balanceAfter === null) throw new AiPointInvariantError();
      return {
        transactionId: reservation.id,
        reservationId: input.reservationId,
        status: 'SUCCEEDED',
        balanceAfter: reservation.balanceAfter,
      };
    }
    if (reservation.status !== 'PENDING') throw new AiPointReservationTerminalError();

    const now = new Date();
    await this.assertResultOwnership(transaction, input.userId, input.result);

    const pointsCost = -reservation.pointsDelta;
    if (pointsCost <= 0 || user.aiPoints < pointsCost) throw new AiPointInvariantError();
    const balanceAfter = user.aiPoints - pointsCost;
    await transaction.user.update({
      where: { id: input.userId },
      data: { aiPoints: balanceAfter },
    });
    const updated = await transaction.aiPointTransaction.updateMany({
      where: { id: reservation.id, status: 'PENDING' },
      data: {
        status: 'SUCCEEDED',
        balanceBefore: user.aiPoints,
        balanceAfter,
        settledAt: now,
        sessionId: input.result.sessionId ?? null,
        messageId: input.result.messageId ?? null,
        proposalId: input.result.proposalId ?? null,
      },
    });
    if (updated.count !== 1) throw new AiPointInvariantError();
    return {
      transactionId: reservation.id,
      reservationId: input.reservationId,
      status: 'SUCCEEDED',
      balanceAfter,
    };
  }

  async release(
    scope: TransactionScope,
    input: { readonly userId: string; readonly reservationId: string },
  ): Promise<PointReleaseReceipt> {
    const transaction = this.unitOfWork.clientFor(scope);
    await this.lockUser(transaction, input.userId);
    const reservation = await this.findReservation(transaction, input.userId, input.reservationId);
    if (reservation.status === 'CANCELLED') {
      if (!reservation.releasedAt) throw new AiPointInvariantError();
      return this.releaseReceipt(reservation, reservation.releasedAt);
    }
    if (reservation.status !== 'PENDING') throw new AiPointReservationTerminalError();

    const releasedAt = new Date();
    const updated = await transaction.aiPointTransaction.updateMany({
      where: { id: reservation.id, status: 'PENDING' },
      data: { status: 'CANCELLED', releasedAt },
    });
    if (updated.count !== 1) {
      const current = await this.findReservation(transaction, input.userId, input.reservationId);
      if (current.status === 'CANCELLED' && current.releasedAt) {
        return this.releaseReceipt(current, current.releasedAt);
      }
      throw new AiPointReservationTerminalError();
    }
    return this.releaseReceipt(reservation, releasedAt);
  }

  async refund(
    scope: TransactionScope,
    input: {
      readonly userId: string;
      readonly debitTransactionId: string;
      readonly reasonCode: string;
    },
  ): Promise<PointRefundReceipt> {
    const transaction = this.unitOfWork.clientFor(scope);
    const user = await this.lockUser(transaction, input.userId);
    const debit = await transaction.aiPointTransaction.findFirst({
      where: { id: input.debitTransactionId, userId: input.userId, type: 'DEBIT' },
    });
    if (!debit || debit.status !== 'SUCCEEDED') throw new AiPointReservationNotFoundError();
    const existing = await transaction.aiPointTransaction.findFirst({
      where: { reversalOfId: debit.id, type: 'REFUND', status: 'SUCCEEDED' },
    });
    if (existing) {
      if (existing.balanceAfter === null) throw new AiPointInvariantError();
      return {
        transactionId: existing.id,
        reversalOfId: debit.id,
        status: 'SUCCEEDED',
        balanceAfter: existing.balanceAfter,
      };
    }

    const pointsDelta = -debit.pointsDelta;
    if (pointsDelta <= 0) throw new AiPointInvariantError();
    const balanceAfter = user.aiPoints + pointsDelta;
    await transaction.user.update({
      where: { id: input.userId },
      data: { aiPoints: balanceAfter },
    });
    const created = await transaction.aiPointTransaction.create({
      data: {
        userId: input.userId,
        type: 'REFUND',
        pointsDelta,
        status: 'SUCCEEDED',
        idempotencyKey: stableKey('refund', debit.id),
        reversalOfId: debit.id,
        capabilityId: debit.capabilityId,
        capabilityCode: debit.capabilityCode,
        endpointCode: debit.endpointCode,
        costRuleVersion: debit.costRuleVersion,
        reasonCode: input.reasonCode,
        configVersion: this.runtime.points.version,
        configHash: this.runtime.points.hash,
        unitCost: pointsDelta,
        balanceBefore: user.aiPoints,
        balanceAfter,
        settledAt: new Date(),
      },
    });
    return {
      transactionId: created.id,
      reversalOfId: debit.id,
      status: 'SUCCEEDED',
      balanceAfter,
    };
  }

  private async topUpDailyLocked(
    transaction: Prisma.TransactionClient,
    user: { id: string; aiPoints: number; timezone: string; createdAt: Date },
    now: Date,
  ): Promise<GrantReceipt | null> {
    const localDate = localDateAt(now, user.timezone);
    if (localDate <= localDateAt(user.createdAt, user.timezone)) return null;

    const periodDate = localDateValue(localDate);
    const existing = await transaction.aiPointTransaction.findFirst({
      where: {
        userId: user.id,
        type: 'GRANT',
        reasonCode: 'daily_allowance_top_up',
        grantPeriodDate: periodDate,
      },
    });
    if (existing) return this.grantReceipt(existing);

    const rule = this.runtime.points.value.grants.dailyTopUpTo;
    const pointsDelta = Math.max(0, rule.points - user.aiPoints);
    const balanceAfter = user.aiPoints + pointsDelta;
    if (pointsDelta > 0) {
      await transaction.user.update({
        where: { id: user.id },
        data: { aiPoints: balanceAfter },
      });
    }
    const created = await transaction.aiPointTransaction.create({
      data: {
        userId: user.id,
        type: 'GRANT',
        pointsDelta,
        status: 'SUCCEEDED',
        idempotencyKey: stableKey('daily', user.id, localDate),
        reasonCode: 'daily_allowance_top_up',
        grantPeriodDate: periodDate,
        grantRuleVersion: rule.ruleVersion,
        configVersion: this.runtime.points.version,
        configHash: this.runtime.points.hash,
        unitCost: pointsDelta,
        balanceBefore: user.aiPoints,
        balanceAfter,
        settledAt: now,
      },
    });
    return this.grantReceipt(created);
  }

  private async lockUser(transaction: Prisma.TransactionClient, userId: string) {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "users"
      WHERE "id" = ${userId}::uuid
      FOR NO KEY UPDATE
    `;
    if (rows.length !== 1) throw new AiPointAccountNotFoundError();
    return transaction.user.findUniqueOrThrow({ where: { id: userId } });
  }

  private async activeReservationTotal(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<number> {
    const result = await transaction.aiPointTransaction.aggregate({
      where: {
        userId,
        type: 'DEBIT',
        status: 'PENDING',
      },
      _sum: { pointsDelta: true },
    });
    return -(result._sum.pointsDelta ?? 0);
  }

  private async findReservation(
    transaction: Prisma.TransactionClient,
    userId: string,
    reservationId: string,
  ): Promise<AiPointTransaction> {
    const reservation = await transaction.aiPointTransaction.findFirst({
      where: { userId, reservationId, type: 'DEBIT' },
    });
    if (!reservation) throw new AiPointReservationNotFoundError();
    return reservation;
  }

  private async reservationReceipt(
    transaction: Prisma.TransactionClient,
    balance: number,
    reservation: AiPointTransaction,
    now: Date,
  ): Promise<ReservationReceipt> {
    if (!reservation.reservationId || !reservation.reservationExpiresAt) {
      throw new AiPointInvariantError();
    }
    if (reservation.status === 'PENDING' && reservation.reservationExpiresAt <= now) {
      throw new AiPointReservationExpiredError();
    }
    if (reservation.status !== 'PENDING' && reservation.status !== 'SUCCEEDED') {
      throw new AiPointReservationTerminalError();
    }
    const activeReserved = await this.activeReservationTotal(transaction, reservation.userId);
    return {
      transactionId: reservation.id,
      reservationId: reservation.reservationId,
      status: reservation.status,
      pointsCost: -reservation.pointsDelta,
      availablePoints: balance - activeReserved,
      expiresAt: reservation.reservationExpiresAt,
    };
  }

  private async assertResultOwnership(
    transaction: Prisma.TransactionClient,
    userId: string,
    result: AiResultReference,
  ): Promise<void> {
    const references = [result.sessionId, result.messageId, result.proposalId].filter(Boolean);
    if (references.length !== 1) throw new AiPointResultReferenceError();

    let owned: number;
    if (result.sessionId) {
      owned = await transaction.conversationSession.count({
        where: { id: result.sessionId, userId },
      });
    } else if (result.messageId) {
      owned = await transaction.message.count({ where: { id: result.messageId, userId } });
    } else if (result.proposalId) {
      owned = await transaction.actionProposal.count({ where: { id: result.proposalId, userId } });
    } else {
      throw new AiPointResultReferenceError();
    }
    if (owned !== 1) throw new AiPointResultReferenceError();
  }

  private assertSameResult(reservation: AiPointTransaction, result: AiResultReference): void {
    if (
      reservation.sessionId !== (result.sessionId ?? null) ||
      reservation.messageId !== (result.messageId ?? null) ||
      reservation.proposalId !== (result.proposalId ?? null)
    ) {
      throw new AiPointResultReferenceError();
    }
  }

  private grantReceipt(transaction: AiPointTransaction): GrantReceipt {
    if (transaction.balanceAfter === null) throw new AiPointInvariantError();
    return {
      transactionId: transaction.id,
      pointsDelta: transaction.pointsDelta,
      balanceAfter: transaction.balanceAfter,
    };
  }

  private releaseReceipt(transaction: AiPointTransaction, releasedAt: Date): PointReleaseReceipt {
    if (!transaction.reservationId) throw new AiPointInvariantError();
    return {
      transactionId: transaction.id,
      reservationId: transaction.reservationId,
      status: 'CANCELLED',
      releasedAt,
    };
  }
}

function stableKey(prefix: string, ...parts: readonly string[]): string {
  const digest = createHash('sha256').update(parts.join('\u0000'), 'utf8').digest('hex');
  return `${prefix}:${digest}`;
}

function validateRequestId(requestId: string): void {
  if (requestId.length < 1 || requestId.length > 128) throw new AiPointInvariantError();
}
