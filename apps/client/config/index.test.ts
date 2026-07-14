import { describe, expect, it } from 'vitest';

import config from './index';

describe('H5 development proxy', () => {
  it('proxies the API namespace without intercepting source modules', async () => {
    expect(config).toBeTypeOf('function');
    if (typeof config !== 'function') throw new Error('Expected functional Taro config');

    const baseConfig = (await config((...configs) => configs[1] ?? {}, {
      command: 'build',
      mode: 'development',
    })) as { h5?: { devServer?: { proxy?: Record<string, unknown> } } };
    const proxyPrefixes = Object.keys(baseConfig.h5?.devServer?.proxy ?? {});

    expect(proxyPrefixes).toEqual(['/api/v1']);
    expect(proxyPrefixes.some((prefix) => '/api-client.ts'.startsWith(prefix))).toBe(false);
  });
});
