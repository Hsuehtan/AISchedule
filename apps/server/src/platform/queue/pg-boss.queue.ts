import { PgBoss, fromPrisma, type PrismaTransactionLike, type SendOptions } from 'pg-boss';

export interface QueuedJob<T> {
  readonly id: string;
  readonly data: T;
}

export class PgBossQueue {
  private readonly boss: PgBoss;

  constructor(connectionString: string, onError: (error: Error) => void = () => undefined) {
    this.boss = new PgBoss({
      connectionString,
      schema: 'pgboss',
      application_name: 'ai-schedule-worker',
    });
    this.boss.on('error', onError);
  }

  async start(): Promise<void> {
    await this.boss.start();
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 5_000 });
  }

  async ensureQueue(name: string): Promise<void> {
    await this.boss.createQueue(name);
  }

  async publish(name: string, data: object): Promise<string> {
    const id = await this.boss.send(name, data);
    if (id === null) {
      throw new Error(`pg-boss declined job for queue ${name}`);
    }
    return id;
  }

  async publishInTransaction(
    name: string,
    data: object,
    transaction: PrismaTransactionLike,
    options: Omit<SendOptions, 'db'> = {},
  ): Promise<string> {
    const id = await this.boss.send(name, data, {
      ...options,
      db: fromPrisma(transaction),
    });
    if (id === null) {
      throw new Error(`pg-boss declined transactional job for queue ${name}`);
    }
    return id;
  }

  async registerWorker<T>(name: string, handler: (data: T) => Promise<void>): Promise<string> {
    return this.boss.work<T>(name, { batchSize: 1, localConcurrency: 1 }, async (jobs) => {
      for (const job of jobs) await handler(job.data);
    });
  }

  async fetchOne<T>(name: string): Promise<QueuedJob<T> | null> {
    const [job] = await this.boss.fetch<T>(name, { batchSize: 1 });
    return job === undefined ? null : { id: job.id, data: job.data };
  }

  async complete(name: string, id: string): Promise<void> {
    await this.boss.complete(name, id);
  }
}
