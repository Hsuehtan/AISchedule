import { z } from 'zod';

export const p0CapabilityCodeSchema = z.enum([
  'agent.standardTurn',
  'agent.planGeneration',
  'speech.transcription',
]);

const pointsValueSchema = z.number().int().nonnegative();

export const pointsConfigSchema = z
  .object({
    version: z.literal(1),
    grants: z
      .object({
        newUser: pointsValueSchema,
        dailyTopUpTo: pointsValueSchema,
      })
      .strict(),
    capabilities: z
      .object({
        'agent.standardTurn': pointsValueSchema,
        'agent.planGeneration': pointsValueSchema,
        'speech.transcription': pointsValueSchema,
      })
      .strict(),
  })
  .strict();

export type P0CapabilityCode = z.infer<typeof p0CapabilityCodeSchema>;
export type PointsConfig = z.infer<typeof pointsConfigSchema>;
