import { DynamicModule, Global, Module } from '@nestjs/common';

import { DATABASE_URL, DatabaseService } from './database.service.js';

@Global()
@Module({})
export class DatabaseModule {
  static register(databaseUrl: string): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [{ provide: DATABASE_URL, useValue: databaseUrl }, DatabaseService],
      exports: [DatabaseService],
    };
  }
}
