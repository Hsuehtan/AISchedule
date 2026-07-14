import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { createPrismaClient, type DatabaseClient } from '@ai-schedule/db';

export const DATABASE_URL = Symbol('DATABASE_URL');

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  readonly client: DatabaseClient;

  constructor(@Inject(DATABASE_URL) databaseUrl: string) {
    this.client = createPrismaClient(databaseUrl);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.$disconnect();
  }
}
