import { z } from 'zod';

export const p0CapabilityCodeSchema = z.enum([
  'agent.standardTurn',
  'agent.planGeneration',
  'speech.transcription',
]);

const pointsValueSchema = z.number().int().nonnegative().max(2_147_483_647);
const ruleVersionSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._-]+$/);
const endpointCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9.-]+$/);

export const pointsGrantRuleSchema = z
  .object({
    points: pointsValueSchema,
    ruleVersion: ruleVersionSchema,
  })
  .strict();

export const aiCapabilityRuleSchema = z
  .object({
    capabilityCode: p0CapabilityCodeSchema,
    endpointCode: endpointCodeSchema,
    name: z.string().trim().min(1).max(80),
    callsModelApi: z.boolean(),
    pointsCost: pointsValueSchema,
    costRuleVersion: ruleVersionSchema,
    enabled: z.boolean(),
  })
  .strict()
  .superRefine((rule, context) => {
    if (rule.callsModelApi && rule.pointsCost === 0) {
      context.addIssue({
        code: 'custom',
        path: ['pointsCost'],
        message: 'model-backed capabilities must have a positive points cost',
      });
    }
    if (!rule.callsModelApi && rule.pointsCost !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['pointsCost'],
        message: 'non-model capabilities must have a zero points cost',
      });
    }
  });

export const pointsConfigSchema = z
  .object({
    version: z.literal(2),
    grants: z
      .object({
        newUser: pointsGrantRuleSchema,
        dailyTopUpTo: pointsGrantRuleSchema,
      })
      .strict(),
    capabilities: z.array(aiCapabilityRuleSchema).length(p0CapabilityCodeSchema.options.length),
  })
  .strict()
  .superRefine((config, context) => {
    const capabilityCodes = new Set(config.capabilities.map((rule) => rule.capabilityCode));
    const endpointCodes = new Set(config.capabilities.map((rule) => rule.endpointCode));

    if (capabilityCodes.size !== p0CapabilityCodeSchema.options.length) {
      context.addIssue({
        code: 'custom',
        path: ['capabilities'],
        message: 'every P0 capability must be configured exactly once',
      });
    }
    if (endpointCodes.size !== config.capabilities.length) {
      context.addIssue({
        code: 'custom',
        path: ['capabilities'],
        message: 'endpoint codes must be unique',
      });
    }
  });

export type P0CapabilityCode = z.infer<typeof p0CapabilityCodeSchema>;
export type AiCapabilityRule = z.infer<typeof aiCapabilityRuleSchema>;
export type PointsConfig = z.infer<typeof pointsConfigSchema>;
