import { DynamicModule, Global, Module } from '@nestjs/common';

import { APPLICATION_OPTIONS, type ResolvedApplicationOptions } from './application-options.js';
import { RUNTIME_CONFIGURATION, type RuntimeConfiguration } from './runtime-configuration.js';

@Global()
@Module({})
export class ApplicationConfigModule {
  static register(
    options: ResolvedApplicationOptions,
    runtime: RuntimeConfiguration,
  ): DynamicModule {
    return {
      module: ApplicationConfigModule,
      providers: [
        { provide: APPLICATION_OPTIONS, useValue: options },
        { provide: RUNTIME_CONFIGURATION, useValue: runtime },
      ],
      exports: [APPLICATION_OPTIONS, RUNTIME_CONFIGURATION],
    };
  }
}
