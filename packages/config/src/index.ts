import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { pointsConfigSchema, type PointsConfig } from '@ai-schedule/contracts';
import { parse } from 'yaml';
import { z, type ZodType } from 'zod';

export interface LoadedConfig<T extends { version: number }> {
  readonly value: T;
  readonly version: T['version'];
  readonly hash: string;
}

export type LoadedPointsConfig = LoadedConfig<PointsConfig>;

const agentProfileSchema = z
  .object({
    model: z.string().min(1),
    timeoutMs: z.number().int().positive(),
    promptVersion: z.string().min(1),
    schemaVersion: z.string().min(1),
  })
  .strict();

export const agentProviderConfigSchema = z
  .object({
    version: z.literal(1),
    provider: z.literal('deepseek'),
    baseUrl: z.url(),
    profiles: z
      .object({
        standard: agentProfileSchema,
        plan: agentProfileSchema,
      })
      .strict(),
  })
  .strict();

export const speechProviderConfigSchema = z
  .object({
    version: z.literal(1),
    provider: z.literal('tencent'),
    profile: z.literal('sentence-recognition'),
    limits: z
      .object({
        maxDurationSeconds: z.number().int().positive().max(60),
        maxBytes: z.number().int().positive().max(3_145_728),
        persistOriginalAudio: z.literal(false),
      })
      .strict(),
  })
  .strict();

export type AgentProviderConfig = z.infer<typeof agentProviderConfigSchema>;
export type SpeechProviderConfig = z.infer<typeof speechProviderConfigSchema>;

function parseYamlConfig<T extends { version: number }>(
  source: string,
  schema: ZodType<T>,
): LoadedConfig<T> {
  const value = schema.parse(parse(source) as unknown);

  return {
    value,
    version: value.version,
    hash: createHash('sha256').update(source, 'utf8').digest('hex'),
  };
}

export function parsePointsConfig(source: string): LoadedPointsConfig {
  return parseYamlConfig(source, pointsConfigSchema);
}

export function parseAgentProviderConfig(source: string): LoadedConfig<AgentProviderConfig> {
  return parseYamlConfig(source, agentProviderConfigSchema);
}

export function parseSpeechProviderConfig(source: string): LoadedConfig<SpeechProviderConfig> {
  return parseYamlConfig(source, speechProviderConfigSchema);
}

export function loadPointsConfig(filePath: string): LoadedPointsConfig {
  return parsePointsConfig(readFileSync(filePath, 'utf8'));
}

export function loadAgentProviderConfig(filePath: string): LoadedConfig<AgentProviderConfig> {
  return parseAgentProviderConfig(readFileSync(filePath, 'utf8'));
}

export function loadSpeechProviderConfig(filePath: string): LoadedConfig<SpeechProviderConfig> {
  return parseSpeechProviderConfig(readFileSync(filePath, 'utf8'));
}
