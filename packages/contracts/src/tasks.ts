import { z } from 'zod';

import { projectIdSchema, taskIdSchema, userIdSchema } from './ids';

const utcDateTimeSchema = z.string().datetime({ offset: true });
const nullableUtcDateTimeSchema = utcDateTimeSchema.nullable();

export const taskStatusSchema = z.enum(['TODO', 'COMPLETED']);
export const taskPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export const taskSourceSchema = z.enum(['MANUAL', 'AGENT']);

export const createTaskInputSchema = z
  .object({
    projectId: projectIdSchema.nullable().optional(),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(2_000).optional(),
    priority: taskPrioritySchema.optional(),
    scheduledAt: nullableUtcDateTimeSchema.optional(),
    deadlineAt: nullableUtcDateTimeSchema.optional(),
    reminderAt: nullableUtcDateTimeSchema.optional(),
  })
  .strict();

export const updateTaskChangesSchema = z
  .object({
    projectId: projectIdSchema.nullable().optional(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2_000).optional(),
    priority: taskPrioritySchema.optional(),
    scheduledAt: nullableUtcDateTimeSchema.optional(),
    deadlineAt: nullableUtcDateTimeSchema.optional(),
    reminderAt: nullableUtcDateTimeSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, '至少需要修改一个字段');

export const updateTaskInputSchema = z
  .object({
    version: z.number().int().positive(),
    changes: updateTaskChangesSchema,
  })
  .strict();

export const taskSchema = z
  .object({
    id: taskIdSchema,
    userId: userIdSchema,
    projectId: projectIdSchema.nullable(),
    title: z.string().min(1).max(200),
    description: z.string().max(2_000),
    status: taskStatusSchema,
    priority: taskPrioritySchema,
    scheduledAt: nullableUtcDateTimeSchema,
    deadlineAt: nullableUtcDateTimeSchema,
    reminderAt: nullableUtcDateTimeSchema,
    completedAt: nullableUtcDateTimeSchema,
    deletedAt: nullableUtcDateTimeSchema,
    source: taskSourceSchema,
    version: z.number().int().positive(),
    createdAt: utcDateTimeSchema,
    updatedAt: utcDateTimeSchema,
  })
  .strict();

export type Task = z.infer<typeof taskSchema>;
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;
