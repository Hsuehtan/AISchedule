import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';
import {
  resolveApplicationOptions,
  type ApplicationOptions,
} from './platform/application-options.js';
import { ApiExceptionFilter } from './platform/http/api-exception.filter.js';
import { OriginGuard } from './platform/http/origin.guard.js';
import { installRequestId, type RequestWithPublicId } from './platform/http/request-id.js';

export async function createApplication(
  options: ApplicationOptions,
): Promise<NestFastifyApplication> {
  const resolved = resolveApplicationOptions(options);
  const adapter = new FastifyAdapter({
    bodyLimit: 1_048_576,
    trustProxy: [...resolved.trustedProxyAddresses],
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(resolved),
    adapter,
    {
      abortOnError: false,
    },
  );
  type NestFastifyPlugin = Parameters<NestFastifyApplication['register']>[0];

  await app.register(cookie as unknown as NestFastifyPlugin);
  await app.register(helmet as unknown as NestFastifyPlugin);
  adapter.getInstance().addHook('onRequest', async (request, reply) => {
    installRequestId(request as unknown as RequestWithPublicId, reply);
  });

  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalGuards(new OriginGuard(resolved.allowedOrigins));
  app.enableShutdownHooks();
  await app.init();
  await adapter.getInstance().ready();
  return app;
}
