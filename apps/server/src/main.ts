import 'reflect-metadata';

import { resolve } from 'node:path';

import { createApplication } from './bootstrap.js';
import {
  parseAgentServiceEnvironment,
  parseAgentRecoveryEnvironment,
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
  const agentRecovery = parseAgentRecoveryEnvironment(
    process.env.AGENT_RECOVERY_INTERVAL_MS,
    process.env.AGENT_RECOVERY_BATCH_SIZE,
  );
  const app = await createApplication({
    databaseUrl,
    allowedOrigins,
    configRoot: process.env.AI_SCHEDULE_CONFIG_ROOT ?? resolve(process.cwd(), '../../config'),
    isProduction,
    sessionTtlDays: parseSessionTtlDays(process.env.SESSION_TTL_DAYS),
    trustedProxyAddresses: parseTrustedProxyAddresses(process.env.TRUSTED_PROXY_ADDRESSES),
    agentRecovery,
    ...(agentService ? { agentService } : {}),
    ...(process.env.AGENT_CONTEXT_SERVICE_TOKEN
      ? { agentContextServiceToken: process.env.AGENT_CONTEXT_SERVICE_TOKEN }
      : {}),
  });

  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  await app.listen({ host: '0.0.0.0', port });
}

void bootstrap();
