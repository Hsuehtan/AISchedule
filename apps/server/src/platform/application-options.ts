import { isIP } from 'node:net';

export interface ApplicationOptions {
  readonly databaseUrl: string;
  readonly allowedOrigins: readonly string[];
  readonly configRoot: string;
  readonly isProduction: boolean;
  readonly sessionTtlDays?: number;
  readonly trustedProxyAddresses?: readonly string[];
  readonly agentService?: Readonly<{
    baseUrl: string;
    serviceToken: string;
  }>;
  readonly agentRecovery?: Readonly<{
    intervalMs: number;
    batchSize: number;
  }>;
}

export interface ResolvedApplicationOptions extends ApplicationOptions {
  readonly sessionTtlDays: number;
  readonly trustedProxyAddresses: readonly string[];
  readonly agentRecovery: Readonly<{ intervalMs: number; batchSize: number }>;
}

export const APPLICATION_OPTIONS = Symbol('APPLICATION_OPTIONS');

export function resolveApplicationOptions(options: ApplicationOptions): ResolvedApplicationOptions {
  const sessionTtlDays = options.sessionTtlDays ?? 30;
  if (!Number.isInteger(sessionTtlDays) || sessionTtlDays < 1 || sessionTtlDays > 365) {
    throw new Error('sessionTtlDays must be an integer between 1 and 365');
  }
  if (options.isProduction && options.allowedOrigins.length === 0) {
    throw new Error('allowedOrigins must not be empty in production');
  }

  const trustedProxyAddresses = options.trustedProxyAddresses ?? ['127.0.0.1', '::1'];
  if (
    trustedProxyAddresses.length === 0 ||
    trustedProxyAddresses.some((address) => isIP(address) === 0)
  ) {
    throw new Error('trustedProxyAddresses must contain only explicit IP addresses');
  }
  const agentRecovery = options.agentRecovery ?? { intervalMs: 30_000, batchSize: 100 };
  if (
    !Number.isInteger(agentRecovery.intervalMs) ||
    agentRecovery.intervalMs < 1_000 ||
    agentRecovery.intervalMs > 300_000
  ) {
    throw new Error('agentRecovery.intervalMs must be an integer between 1000 and 300000');
  }
  if (
    !Number.isInteger(agentRecovery.batchSize) ||
    agentRecovery.batchSize < 5 ||
    agentRecovery.batchSize > 1_000
  ) {
    throw new Error('agentRecovery.batchSize must be an integer between 5 and 1000');
  }

  return {
    ...options,
    allowedOrigins: [...options.allowedOrigins],
    sessionTtlDays,
    trustedProxyAddresses: [...new Set(trustedProxyAddresses)],
    agentRecovery: { ...agentRecovery },
  };
}
