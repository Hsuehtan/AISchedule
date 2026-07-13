import 'dotenv/config';

import { defineConfig } from 'prisma/config';

const localDatabaseUrl = 'postgresql://ai_schedule:ai_schedule@127.0.0.1:5432/ai_schedule';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? localDatabaseUrl,
  },
});
