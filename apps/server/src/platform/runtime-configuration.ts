import type { loadRuntimeConfiguration } from '../runtime-config.js';

export type RuntimeConfiguration = ReturnType<typeof loadRuntimeConfiguration>;

export const RUNTIME_CONFIGURATION = Symbol('RUNTIME_CONFIGURATION');
