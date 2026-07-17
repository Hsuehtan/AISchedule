import 'reflect-metadata';

import { resolve } from 'node:path';

import { createApplication } from './bootstrap.js';
import {
  parseAgentServiceEnvironment,
  parseAllowedOrigins,
  parseSessionTtlDays,
  parseTrustedProxyAddresses,
} from './runtime-environment.js';

async function bootstrap() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const isProduction = process.env.NODE_ENV === 'production';
  const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS, isProduction);
  const agentService = parseAgentServiceEnvironment(
    process.env.AGENT_SERVICE_URL,
    process.env.AGENT_SERVICE_TOKEN,
  );
  const app = await createApplication({
    databaseUrl,
    allowedOrigins,
    configRoot: process.env.AI_SCHEDULE_CONFIG_ROOT ?? resolve(process.cwd(), '../../config'),
    isProduction,
    sessionTtlDays: parseSessionTtlDays(process.env.SESSION_TTL_DAYS),
    trustedProxyAddresses: parseTrustedProxyAddresses(process.env.TRUSTED_PROXY_ADDRESSES),
    ...(agentService ? { agentService } : {}),
  });

  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  await app.listen({ host: '0.0.0.0', port });
}

void bootstrap();
