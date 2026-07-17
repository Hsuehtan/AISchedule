import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { createPrismaClient } from '@ai-schedule/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PgBossQueue } from '../src/platform/queue/pg-boss.queue.js';

describe('pg-boss persistence boundary', () => {
  const container = new PostgreSqlContainer('postgres:16-alpine');
  let startedContainer: Awaited<ReturnType<typeof container.start>>;

  beforeAll(async () => {
    startedContainer = await container.start();
  }, 120_000);

  afterAll(async () => {
    await startedContainer?.stop();
  });

  it('keeps an Agent request available across queue instances', async () => {
    const databaseUrl = startedContainer.getConnectionUri();
    const queueName = 'agent-request';
    const producer = new PgBossQueue(databaseUrl);

    await producer.start();
    await producer.ensureQueue(queueName);
    const jobId = await producer.publish(queueName, { requestId: 'request-1' });
    await producer.stop();

    const consumer = new PgBossQueue(databaseUrl);
    await consumer.start();
    const job = await consumer.fetchOne<{ requestId: string }>(queueName);

    expect(job).toMatchObject({ id: jobId, data: { requestId: 'request-1' } });
    await consumer.complete(queueName, job!.id);
    expect(await consumer.fetchOne(queueName)).toBeNull();
    await consumer.stop();
  });

  it('joins enqueue to an existing Prisma transaction', async () => {
    const databaseUrl = startedContainer.getConnectionUri();
    const queueName = 'agent-admission-atomic';
    const queue = new PgBossQueue(databaseUrl);
    const database = createPrismaClient(databaseUrl);
    await queue.start();
    await queue.ensureQueue(queueName);

    await expect(
      database.$transaction(async (transaction) => {
        await queue.publishInTransaction(queueName, { requestId: 'rolled-back' }, transaction);
        throw new Error('rollback admission');
      }),
    ).rejects.toThrow('rollback admission');
    expect(await queue.fetchOne(queueName)).toBeNull();

    const jobId = await database.$transaction((transaction) =>
      queue.publishInTransaction(queueName, { requestId: 'committed' }, transaction),
    );
    expect(await queue.fetchOne(queueName)).toMatchObject({
      id: jobId,
      data: { requestId: 'committed' },
    });

    await database.$disconnect();
    await queue.stop();
  });
});
