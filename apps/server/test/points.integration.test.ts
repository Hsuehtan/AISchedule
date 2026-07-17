import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { createPrismaClient, type DatabaseClient } from '@ai-schedule/db';
import { loadPointsConfig } from '@ai-schedule/config';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../src/bootstrap.js';
import {
  AdminPointsReservedBalanceError,
  AdminPointsService,
} from '../src/admin/admin-points.service.js';
import {
  AI_POINTS_PORT,
  InsufficientAiPointsError,
  type AiPointsPort,
} from '../src/modules/users/points/ai-points.port.js';
import {
  CapabilityRegistryService,
  CapabilityRuleVersionConflictError,
} from '../src/modules/users/points/capability-registry.service.js';
import type { DatabaseService } from '../src/platform/database/database.service.js';
import { DatabaseUnitOfWork } from '../src/platform/database/unit-of-work.js';
import { loadRuntimeConfiguration } from '../src/runtime-config.js';

const execFileAsync = promisify(execFile);
const origin = 'http://127.0.0.1:4173';

describe('AI points subsystem', () => {
  const container = new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('ai_schedule')
    .withUsername('ai_schedule')
    .withPassword('ai_schedule');

  let startedContainer: Awaited<ReturnType<typeof container.start>>;
  let app: NestFastifyApplication;
  let db: DatabaseClient;
  let points: AiPointsPort;
  let unitOfWork: DatabaseUnitOfWork;

  beforeAll(async () => {
    startedContainer = await container.start();
    const databaseUrl = startedContainer.getConnectionUri();
    await execFileAsync(
      'pnpm',
      ['exec', 'prisma', 'migrate', 'deploy', '--config', 'prisma.config.ts'],
      {
        cwd: resolve(process.cwd(), '../../packages/db'),
        env: { ...process.env, DATABASE_URL: databaseUrl },
      },
    );
    db = createPrismaClient(databaseUrl);
    app = await createApplication({
      databaseUrl,
      allowedOrigins: [origin],
      configRoot: resolve(process.cwd(), '../../config'),
      isProduction: false,
    });
    points = app.get<AiPointsPort>(AI_POINTS_PORT);
    unitOfWork = app.get(DatabaseUnitOfWork);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    await startedContainer?.stop();
  });

  it('synchronizes one immutable active version for every configured capability', async () => {
    const capabilities = await db.aiCapability.findMany({ orderBy: { capabilityCode: 'asc' } });

    expect(capabilities).toHaveLength(3);
    expect(capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capabilityCode: 'agent.standardTurn',
          endpointCode: 'agent.turn',
          pointsCost: 1,
          costRuleVersion: 'agent-standard-v1',
          status: 'ACTIVE',
        }),
        expect.objectContaining({
          capabilityCode: 'agent.planGeneration',
          pointsCost: 2,
          status: 'ACTIVE',
        }),
      ]),
    );

    const configRoot = resolve(process.cwd(), '../../config');
    const runtime = loadRuntimeConfiguration(configRoot);
    const changedWithoutVersion = {
      ...runtime,
      points: {
        ...runtime.points,
        value: {
          ...runtime.points.value,
          capabilities: runtime.points.value.capabilities.map((capability) =>
            capability.capabilityCode === 'agent.standardTurn'
              ? { ...capability, name: '未升级版本却修改的规则' }
              : capability,
          ),
        },
      },
    };
    const registry = new CapabilityRegistryService(
      { client: db } as DatabaseService,
      changedWithoutVersion,
    );
    await expect(registry.synchronize()).rejects.toBeInstanceOf(CapabilityRuleVersionConflictError);
    expect(await db.aiCapability.count()).toBe(3);
  });

  it('rejects an endpoint change without a new capability cost rule version', async () => {
    const configRoot = resolve(process.cwd(), '../../config');
    const runtime = loadRuntimeConfiguration(configRoot);
    const changedEndpointWithoutVersion = {
      ...runtime,
      points: {
        ...runtime.points,
        value: {
          ...runtime.points.value,
          capabilities: runtime.points.value.capabilities.map((capability) =>
            capability.capabilityCode === 'agent.standardTurn'
              ? { ...capability, endpointCode: 'agent.turn-v2' }
              : capability,
          ),
        },
      },
    };

    const registry = new CapabilityRegistryService(
      { client: db } as DatabaseService,
      changedEndpointWithoutVersion,
    );

    await expect(registry.synchronize()).rejects.toBeInstanceOf(CapabilityRuleVersionConflictError);
    expect(
      await db.aiCapability.count({
        where: {
          capabilityCode: 'agent.standardTurn',
          costRuleVersion: 'agent-standard-v1',
        },
      }),
    ).toBe(1);
  });

  it('lazily tops up once per local day and reserves without changing the booked balance', async () => {
    const user = await db.user.create({
      data: {
        aiPoints: 0,
        timezone: 'Asia/Shanghai',
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000),
      },
    });

    const first = await unitOfWork.run((scope) =>
      points.reserve(scope, {
        userId: user.id,
        capabilityCode: 'agent.standardTurn',
        endpointCode: 'agent.turn',
        requestId: 'request-daily-reserve',
      }),
    );
    const replay = await unitOfWork.run((scope) =>
      points.reserve(scope, {
        userId: user.id,
        capabilityCode: 'agent.standardTurn',
        endpointCode: 'agent.turn',
        requestId: 'request-daily-reserve',
      }),
    );

    expect(replay).toEqual(first);
    expect(first).toMatchObject({ status: 'PENDING', pointsCost: 1, availablePoints: 9 });
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).aiPoints).toBe(10);
    expect(
      await db.aiPointTransaction.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
      }),
    ).toEqual([
      expect.objectContaining({
        type: 'GRANT',
        status: 'SUCCEEDED',
        pointsDelta: 10,
        reasonCode: 'daily_allowance_top_up',
      }),
      expect.objectContaining({
        type: 'DEBIT',
        status: 'PENDING',
        pointsDelta: -1,
        balanceBefore: null,
        balanceAfter: null,
      }),
    ]);
  });

  it('serializes concurrent reservations so booked points cannot be overcommitted', async () => {
    const user = await db.user.create({ data: { aiPoints: 1 } });

    const attempts = await Promise.allSettled(
      ['concurrent-a', 'concurrent-b'].map((requestId) =>
        unitOfWork.run((scope) =>
          points.reserve(scope, {
            userId: user.id,
            capabilityCode: 'agent.standardTurn',
            endpointCode: 'agent.turn',
            requestId,
          }),
        ),
      ),
    );

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === 'rejected');
    expect(rejected?.status === 'rejected' ? rejected.reason : null).toBeInstanceOf(
      InsufficientAiPointsError,
    );
    expect(
      await db.aiPointTransaction.count({
        where: { userId: user.id, type: 'DEBIT', status: 'PENDING' },
      }),
    ).toBe(1);
  });

  it('keeps an expired pending debit reserved and permits settlement after result persistence', async () => {
    const user = await db.user.create({ data: { aiPoints: 2 } });
    const reservation = await unitOfWork.run((scope) =>
      points.reserve(scope, {
        userId: user.id,
        capabilityCode: 'agent.planGeneration',
        endpointCode: 'agent.plan-generation',
        requestId: 'expired-pending-reservation',
      }),
    );
    const reservedAt = new Date(Date.now() - 10 * 60 * 1_000);
    await db.aiPointTransaction.update({
      where: { id: reservation.transactionId },
      data: {
        reservedAt,
        reservationExpiresAt: new Date(reservedAt.getTime() + 5 * 60 * 1_000),
      },
    });

    await expect(
      unitOfWork.run((scope) =>
        points.reserve(scope, {
          userId: user.id,
          capabilityCode: 'agent.standardTurn',
          endpointCode: 'agent.turn',
          requestId: 'blocked-by-expired-pending',
        }),
      ),
    ).rejects.toBeInstanceOf(InsufficientAiPointsError);

    const admin = new AdminPointsService(
      db,
      loadPointsConfig(resolve(process.cwd(), '../../config/product/points.yaml')),
    );
    await expect(
      admin.adjust({
        lookup: { userId: user.id },
        operation: 'SET',
        value: 1,
        operator: 'haon',
        reason: '过期 lease 仍需保护预留',
        dryRun: false,
      }),
    ).rejects.toBeInstanceOf(AdminPointsReservedBalanceError);

    const conversation = await db.conversationSession.create({ data: { userId: user.id } });
    await expect(
      unitOfWork.run((scope) =>
        points.settle(scope, {
          userId: user.id,
          reservationId: reservation.reservationId,
          result: { sessionId: conversation.id },
        }),
      ),
    ).resolves.toMatchObject({ status: 'SUCCEEDED', balanceAfter: 0 });
  });

  it('settles, releases and refunds reservations idempotently', async () => {
    const user = await db.user.create({ data: { aiPoints: 3 } });
    const conversation = await db.conversationSession.create({ data: { userId: user.id } });
    const settledReservation = await unitOfWork.run((scope) =>
      points.reserve(scope, {
        userId: user.id,
        capabilityCode: 'agent.standardTurn',
        endpointCode: 'agent.turn',
        requestId: 'settled-request',
      }),
    );

    const settled = await unitOfWork.run((scope) =>
      points.settle(scope, {
        userId: user.id,
        reservationId: settledReservation.reservationId,
        result: { sessionId: conversation.id },
      }),
    );
    const settledReplay = await unitOfWork.run((scope) =>
      points.settle(scope, {
        userId: user.id,
        reservationId: settledReservation.reservationId,
        result: { sessionId: conversation.id },
      }),
    );
    expect(settledReplay).toEqual(settled);
    expect(settled).toMatchObject({ status: 'SUCCEEDED', balanceAfter: 2 });

    const message = await db.message.create({
      data: {
        userId: user.id,
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content: '不能同时绑定两个计费结果',
      },
    });
    await expect(
      db.aiPointTransaction.update({
        where: { id: settled.transactionId },
        data: { messageId: message.id },
      }),
    ).rejects.toThrow();

    const refunded = await unitOfWork.run((scope) =>
      points.refund(scope, {
        userId: user.id,
        debitTransactionId: settled.transactionId,
        reasonCode: 'billing_correction',
      }),
    );
    const refundReplay = await unitOfWork.run((scope) =>
      points.refund(scope, {
        userId: user.id,
        debitTransactionId: settled.transactionId,
        reasonCode: 'billing_correction',
      }),
    );
    expect(refundReplay).toEqual(refunded);
    expect(refunded).toMatchObject({ status: 'SUCCEEDED', balanceAfter: 3 });

    const releasable = await unitOfWork.run((scope) =>
      points.reserve(scope, {
        userId: user.id,
        capabilityCode: 'agent.standardTurn',
        endpointCode: 'agent.turn',
        requestId: 'released-request',
      }),
    );
    const extendedExpiry = new Date(Date.now() + 10 * 60 * 1_000);
    const extended = await unitOfWork.run((scope) =>
      points.extendLease(scope, {
        userId: user.id,
        reservationId: releasable.reservationId,
        expiresAt: extendedExpiry,
      }),
    );
    expect(extended.expiresAt).toEqual(extendedExpiry);
    const released = await unitOfWork.run((scope) =>
      points.release(scope, { userId: user.id, reservationId: releasable.reservationId }),
    );
    const releaseReplay = await unitOfWork.run((scope) =>
      points.release(scope, { userId: user.id, reservationId: releasable.reservationId }),
    );
    expect(releaseReplay).toEqual(released);
    expect(released).toMatchObject({ status: 'CANCELLED' });
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).aiPoints).toBe(3);
  });

  it('records a zero-delta daily evaluation and never tops up again after same-day spend', async () => {
    const user = await db.user.create({
      data: {
        aiPoints: 20,
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000),
      },
    });
    const conversation = await db.conversationSession.create({ data: { userId: user.id } });
    const first = await unitOfWork.run((scope) =>
      points.reserve(scope, {
        userId: user.id,
        capabilityCode: 'agent.standardTurn',
        endpointCode: 'agent.turn',
        requestId: 'zero-top-up-first',
      }),
    );
    await unitOfWork.run((scope) =>
      points.settle(scope, {
        userId: user.id,
        reservationId: first.reservationId,
        result: { sessionId: conversation.id },
      }),
    );
    await unitOfWork.run((scope) =>
      points.reserve(scope, {
        userId: user.id,
        capabilityCode: 'agent.standardTurn',
        endpointCode: 'agent.turn',
        requestId: 'zero-top-up-second',
      }),
    );

    const daily = await db.aiPointTransaction.findMany({
      where: { userId: user.id, reasonCode: 'daily_allowance_top_up' },
    });
    expect(daily).toEqual([
      expect.objectContaining({ pointsDelta: 0, balanceBefore: 20, balanceAfter: 20 }),
    ]);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).aiPoints).toBe(19);
  });

  it('audits admin adjustments and never consumes points held by an active reservation', async () => {
    const user = await db.user.create({ data: { aiPoints: 3 } });
    await unitOfWork.run((scope) =>
      points.reserve(scope, {
        userId: user.id,
        capabilityCode: 'agent.planGeneration',
        endpointCode: 'agent.plan-generation',
        requestId: 'admin-reserved-balance',
      }),
    );
    const configRoot = resolve(process.cwd(), '../../config');
    const admin = new AdminPointsService(
      db,
      loadPointsConfig(resolve(configRoot, 'product/points.yaml')),
    );

    await expect(
      admin.adjust({
        lookup: { userId: user.id },
        operation: 'SUBTRACT',
        value: 2,
        operator: 'haon',
        reason: '不得侵占预留',
        dryRun: false,
      }),
    ).rejects.toBeInstanceOf(AdminPointsReservedBalanceError);

    await expect(
      admin.adjust({
        lookup: { userId: user.id },
        operation: 'ADD',
        value: 5,
        operator: 'haon',
        reason: '演练',
        dryRun: true,
      }),
    ).resolves.toMatchObject({ balanceBefore: 3, balanceAfter: 8, dryRun: true });
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).aiPoints).toBe(3);

    for (const adjustment of [
      { operation: 'ADD' as const, value: 2, expected: 5 },
      { operation: 'SUBTRACT' as const, value: 1, expected: 4 },
      { operation: 'SET' as const, value: 10, expected: 10 },
    ]) {
      await expect(
        admin.adjust({
          lookup: { userId: user.id },
          operation: adjustment.operation,
          value: adjustment.value,
          operator: 'haon',
          reason: '内测账务调整',
          dryRun: false,
        }),
      ).resolves.toMatchObject({ balanceAfter: adjustment.expected, dryRun: false });
    }

    expect(
      await db.aiPointTransaction.count({
        where: { userId: user.id, type: 'ADJUSTMENT', status: 'SUCCEEDED' },
      }),
    ).toBe(3);
    expect(await db.adminAuditEvent.count({ where: { targetUserId: user.id } })).toBe(3);
    expect(await admin.history({ userId: user.id }, 10)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'ADJUSTMENT', operator: 'haon' })]),
    );
  });
});
