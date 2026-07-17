import { describe, expect, it } from 'vitest';

import {
  parseAgentServiceEnvironment,
  parseAllowedOrigins,
  parseSessionTtlDays,
  parseTrustedProxyAddresses,
} from './runtime-environment.js';

describe('runtime environment parsing', () => {
  it('keeps Agent admission disabled until both private service settings exist', () => {
    expect(parseAgentServiceEnvironment(undefined, undefined)).toBeUndefined();
    expect(parseAgentServiceEnvironment('http://agent-service:8081', undefined)).toBeUndefined();
    expect(parseAgentServiceEnvironment(undefined, 'private-token')).toBeUndefined();
    expect(parseAgentServiceEnvironment('http://agent-service:8081/', 'private-token')).toEqual({
      baseUrl: 'http://agent-service:8081',
      serviceToken: 'private-token',
    });
    expect(() => parseAgentServiceEnvironment('file:///tmp/agent.sock', 'private-token')).toThrow(
      /AGENT_SERVICE_URL/,
    );
    expect(() =>
      parseAgentServiceEnvironment('http://agent-service:8081/private', 'private-token'),
    ).toThrow(/AGENT_SERVICE_URL/);
  });

  it('accepts only a full-string positive integer session TTL in the supported range', () => {
    expect(parseSessionTtlDays(undefined)).toBe(30);
    expect(parseSessionTtlDays('30')).toBe(30);

    for (const invalid of ['', '0', '366', '30days', ' 30', '30.5', '+30']) {
      expect(() => parseSessionTtlDays(invalid)).toThrow(/SESSION_TTL_DAYS/);
    }
  });

  it('requires an explicit origin allowlist in production', () => {
    expect(() => parseAllowedOrigins(undefined, true)).toThrow(/ALLOWED_ORIGINS/);
    expect(parseAllowedOrigins('https://schedule.example.com', true)).toEqual([
      'https://schedule.example.com',
    ]);
    expect(parseAllowedOrigins(undefined, false)).toContain('http://127.0.0.1:10086');
  });

  it('trusts loopback proxies by default and accepts only explicit IP addresses', () => {
    expect(parseTrustedProxyAddresses(undefined)).toEqual(['127.0.0.1', '::1']);
    expect(parseTrustedProxyAddresses('10.0.0.2, 2001:db8::1')).toEqual([
      '10.0.0.2',
      '2001:db8::1',
    ]);

    for (const invalid of ['', '*', 'true', '0.0.0.0/0', 'proxy.internal']) {
      expect(() => parseTrustedProxyAddresses(invalid)).toThrow(/TRUSTED_PROXY_ADDRESSES/);
    }
  });
});
