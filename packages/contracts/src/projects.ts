import { z } from 'zod';

import { projectIdSchema, userIdSchema } from './ids.js';

const utcDateTimeSchema = z.string().datetime({ offset: true });

export const projectColorKeySchema = z.enum(['pink', 'teal', 'purple', 'amber', 'cyan', 'slate']);
export const projectStatusSchema = z.enum(['ACTIVE', 'ARCHIVED']);

export const createProjectInputSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
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

export const projectListQuerySchema = z
  .object({
    status: projectStatusSchema.default('ACTIVE'),
    cursor: projectIdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export const projectListResponseSchema = z
  .object({
    items: z.array(projectSchema),
    pageInfo: z.object({ nextCursor: projectIdSchema.nullable() }).strict(),
  })
  .strict();

export const updateProjectInputSchema = z
  .object({
    version: z.number().int().positive(),
    changes: z.object({ name: z.string().trim().min(1).max(40) }).strict(),
  })
  .strict();

export const archiveProjectInputSchema = z
  .object({ version: z.number().int().positive() })
  .strict();

export const projectMutationResponseSchema = z.object({ project: projectSchema }).strict();

export type Project = z.infer<typeof projectSchema>;
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;
export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;
export type ArchiveProjectInput = z.infer<typeof archiveProjectInputSchema>;
export type ProjectMutationResponse = z.infer<typeof projectMutationResponseSchema>;
