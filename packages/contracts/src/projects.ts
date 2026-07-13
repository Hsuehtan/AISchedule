import { z } from 'zod';

import { projectIdSchema, userIdSchema } from './ids.js';

const utcDateTimeSchema = z.string().datetime({ offset: true });

export const projectColorKeySchema = z.enum([
  'pink',
  'teal',
  'purple',
  'amber',
  'cyan',
  'slate',
]);
export const projectStatusSchema = z.enum(['ACTIVE', 'ARCHIVED']);

export const createProjectInputSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    colorKey: projectColorKeySchema,
  })
  .strict();

export const projectSchema = z
  .object({
    id: projectIdSchema,
    userId: userIdSchema,
    name: z.string().min(1).max(40),
    colorKey: projectColorKeySchema,
    status: projectStatusSchema,
    archivedAt: utcDateTimeSchema.nullable(),
    taskCount: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    createdAt: utcDateTimeSchema,
    updatedAt: utcDateTimeSchema,
  })
  .strict();

export type Project = z.infer<typeof projectSchema>;
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
