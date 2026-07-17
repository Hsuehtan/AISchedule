import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@ai-schedule/db';

import { DatabaseService } from './database.service.js';

declare const TRANSACTION_SCOPE_BRAND: unique symbol;

/**
 * An intentionally opaque handle. Application services may compose ports in one
 * transaction but cannot use the handle as a Prisma client.
 */
export interface TransactionScope {
  readonly [TRANSACTION_SCOPE_BRAND]: true;
}

export type TransactionWork<T> = (scope: TransactionScope) => Promise<T>;

/**
 * Application-facing transaction boundary. Agent orchestration injects this
 * token and can only compose transaction-scoped ports. The modular-monolith
 * boundary is enforced by the adjacent architecture test.
 */
export const UNIT_OF_WORK = Symbol('UnitOfWork');

export interface UnitOfWork {
  run<T>(work: TransactionWork<T>): Promise<T>;
}

@Injectable()
export class DatabaseUnitOfWork implements UnitOfWork {
  private readonly clients = new WeakMap<TransactionScope, Prisma.TransactionClient>();

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async run<T>(work: TransactionWork<T>): Promise<T> {
    return this.database.client.$transaction(async (client) => {
      const scope = Object.freeze({}) as TransactionScope;
      this.clients.set(scope, client);
      try {
        return await work(scope);
      } finally {
        this.clients.delete(scope);
      }
    });
  }

  /** For transaction-scoped repository/port adapters only, never API controllers. */
  clientFor(scope: TransactionScope): Prisma.TransactionClient {
    const client = this.clients.get(scope);
    if (!client) throw new InvalidTransactionScopeError();
    return client;
  }
}

export class InvalidTransactionScopeError extends Error {
  constructor() {
    super('TransactionScope is not active in this UnitOfWork');
    this.name = 'InvalidTransactionScopeError';
  }
}
