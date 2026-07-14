import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/prisma/client.js';

export type DatabaseClient = PrismaClient;

export function createPrismaClient(connectionString: string): DatabaseClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}
