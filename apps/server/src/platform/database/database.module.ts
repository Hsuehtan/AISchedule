import { DynamicModule, Global, Module } from '@nestjs/common';

import { DATABASE_URL, DatabaseService } from './database.service.js';
import { DatabaseUnitOfWork, UNIT_OF_WORK } from './unit-of-work.js';

@Global()
@Module({})
export class DatabaseModule {
  static register(databaseUrl: string): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        { provide: DATABASE_URL, useValue: databaseUrl },
        DatabaseService,
        DatabaseUnitOfWork,
        { provide: UNIT_OF_WORK, useExisting: DatabaseUnitOfWork },
      ],
      exports: [DatabaseService, DatabaseUnitOfWork, UNIT_OF_WORK],
    };
  }
}
