import type { P0CapabilityCode } from '@ai-schedule/contracts';

import type { TransactionScope } from '../../../platform/database/unit-of-work.js';

export const AI_POINTS_PORT = Symbol('AI_POINTS_PORT');

export interface ReserveAiPointsInput {
  readonly userId: string;
  readonly capabilityCode: P0CapabilityCode;
  readonly endpointCode: string;
  readonly requestId: string;
}

export type AiResultReference =
  | { readonly sessionId: string; readonly messageId?: never; readonly proposalId?: never }
  | { readonly sessionId?: never; readonly messageId: string; readonly proposalId?: never }
  | { readonly sessionId?: never; readonly messageId?: never; readonly proposalId: string };

export interface ReservationReceipt {
  readonly transactionId: string;
  readonly reservationId: string;
  readonly status: 'PENDING' | 'SUCCEEDED';
  readonly pointsCost: number;
  readonly availablePoints: number;
  readonly expiresAt: Date;
}

export interface PointSettlementReceipt {
  readonly transactionId: string;
  readonly reservationId: string;
  readonly status: 'SUCCEEDED';
  readonly balanceAfter: number;
}

export interface PointReleaseReceipt {
  readonly transactionId: string;
  readonly reservationId: string;
  readonly status: 'CANCELLED';
  readonly releasedAt: Date;
}

export interface PointRefundReceipt {
  readonly transactionId: string;
  readonly reversalOfId: string;
  readonly status: 'SUCCEEDED';
  readonly balanceAfter: number;
}

export interface GrantReceipt {
  readonly transactionId: string;
  readonly pointsDelta: number;
  readonly balanceAfter: number;
}

export interface AiPointsPort {
  grantNewUser(scope: TransactionScope, userId: string): Promise<GrantReceipt>;
  topUpDaily(scope: TransactionScope, userId: string): Promise<GrantReceipt | null>;
  reserve(scope: TransactionScope, input: ReserveAiPointsInput): Promise<ReservationReceipt>;
  extendLease(
    scope: TransactionScope,
    input: { readonly userId: string; readonly reservationId: string; readonly expiresAt: Date },
  ): Promise<ReservationReceipt>;
  settle(
    scope: TransactionScope,
    input: {
      readonly userId: string;
      readonly reservationId: string;
      readonly result: AiResultReference;
    },
  ): Promise<PointSettlementReceipt>;
  release(
    scope: TransactionScope,
    input: { readonly userId: string; readonly reservationId: string },
  ): Promise<PointReleaseReceipt>;
  refund(
    scope: TransactionScope,
    input: {
      readonly userId: string;
      readonly debitTransactionId: string;
      readonly reasonCode: string;
    },
  ): Promise<PointRefundReceipt>;
}

export class InsufficientAiPointsError extends Error {
  constructor() {
    super('AI points are insufficient');
    this.name = 'InsufficientAiPointsError';
  }
}

export class AiCapabilityUnavailableError extends Error {
  constructor() {
    super('AI capability is unavailable');
    this.name = 'AiCapabilityUnavailableError';
  }
}

export class AiPointAccountNotFoundError extends Error {
  constructor() {
    super('AI point account was not found');
    this.name = 'AiPointAccountNotFoundError';
  }
}

export class AiPointReservationNotFoundError extends Error {
  constructor() {
    super('AI point reservation was not found');
    this.name = 'AiPointReservationNotFoundError';
  }
}

export class AiPointReservationTerminalError extends Error {
  constructor(message = 'AI point reservation is already terminal') {
    super(message);
    this.name = 'AiPointReservationTerminalError';
  }
}

export class AiPointReservationExpiredError extends Error {
  constructor() {
    super('AI point reservation has expired');
    this.name = 'AiPointReservationExpiredError';
  }
}

export class AiPointResultReferenceError extends Error {
  constructor() {
    super('AI result reference is invalid for the point account');
    this.name = 'AiPointResultReferenceError';
  }
}

export class AiPointInvariantError extends Error {
  constructor() {
    super('AI point account invariant was violated');
    this.name = 'AiPointInvariantError';
  }
}
