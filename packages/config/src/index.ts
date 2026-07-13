import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { pointsConfigSchema, type PointsConfig } from '@ai-schedule/contracts';
import { parse } from 'yaml';

export interface LoadedPointsConfig {
  readonly value: PointsConfig;
  readonly version: PointsConfig['version'];
  readonly hash: string;
}

export function parsePointsConfig(source: string): LoadedPointsConfig {
  const value = pointsConfigSchema.parse(parse(source) as unknown);

  return {
    value,
    version: value.version,
    hash: createHash('sha256').update(source, 'utf8').digest('hex'),
  };
}

export function loadPointsConfig(filePath: string): LoadedPointsConfig {
  return parsePointsConfig(readFileSync(filePath, 'utf8'));
}
