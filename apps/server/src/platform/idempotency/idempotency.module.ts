import { Module } from '@nestjs/common';

import { IdempotencyService } from './idempotency.service.js';

@Module({
  providers: [IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
