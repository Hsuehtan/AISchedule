import { isIP } from 'node:net';

const DEVELOPMENT_ORIGINS = [
  'http://127.0.0.1:10086',
  'http://localhost:10086',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
] as const;

const LOOPBACK_PROXY_ADDRESSES = ['127.0.0.1', '::1'] as const;

export function parseAgentRecoveryEnvironment(
  rawIntervalMs: string | undefined,
  rawBatchSize: string | undefined,
): { intervalMs: number; batchSize: number } {
  return {
    intervalMs: parseBoundedInteger(
      rawIntervalMs,
      30_000,
      1_000,
      300_000,
      'AGENT_RECOVERY_INTERVAL_MS',
    ),
    batchSize: parseBoundedInteger(rawBatchSize, 100, 5, 1_000, 'AGENT_RECOVERY_BATCH_SIZE'),
  };
}

export function parseAgentServiceEnvironment(
  rawBaseUrl: string | undefined,
  serviceToken: string | undefined,
): { baseUrl: string; serviceToken: string } | undefined {
  if (!rawBaseUrl || !serviceToken) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(rawBaseUrl);
  } catch {
    throw new Error('AGENT_SERVICE_URL must be a valid HTTP(S) URL');
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    (parsed.pathname !== '/' && parsed.pathname !== '') ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('AGENT_SERVICE_URL must be a valid HTTP(S) URL');
  }
  return { baseUrl: parsed.origin, serviceToken };
}

export function parseSessionTtlDays(value: string | undefined): number {
  if (value === undefined) return 30;
  if (!/^[1-9]\d{0,2}$/.test(value)) {
    throw new Error('SESSION_TTL_DAYS must be a whole number between 1 and 365');
  }

  const days = Number(value);
  if (days > 365) {
    throw new Error('SESSION_TTL_DAYS must be a whole number between 1 and 365');
  }
  return days;
}

export function parseAllowedOrigins(value: string | undefined, isProduction: boolean): string[] {
  if (value === undefined && isProduction) {
    throw new Error('ALLOWED_ORIGINS is required in production');
  }

  const candidates = value === undefined ? DEVELOPMENT_ORIGINS : value.split(',');
  const origins = candidates.map((candidate) => normalizeOrigin(candidate.trim())).filter(Boolean);
  if (origins.length === 0) throw new Error('ALLOWED_ORIGINS must contain at least one origin');
  return [...new Set(origins)];
}

export function parseTrustedProxyAddresses(value: string | undefined): string[] {
  if (value === undefined) return [...LOOPBACK_PROXY_ADDRESSES];

  const addresses = value
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);
  if (addresses.length === 0 || addresses.some((address) => isIP(address) === 0)) {
    throw new Error('TRUSTED_PROXY_ADDRESSES must contain only explicit IPv4 or IPv6 addresses');
  }
  return [...new Set(addresses)];
}

function normalizeOrigin(candidate: string): string {
  if (!candidate) return '';

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('ALLOWED_ORIGINS must contain valid HTTP(S) origins');
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    (parsed.pathname !== '/' && parsed.pathname !== '') ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('ALLOWED_ORIGINS must contain valid HTTP(S) origins');
  }
  return parsed.origin;
}

function parseBoundedInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (raw === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  const value = Number(raw);
  if (value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}
