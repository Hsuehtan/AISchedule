import { z } from 'zod';

import { projectIdSchema, taskIdSchema, undoOperationIdSchema, userIdSchema } from './ids.js';
import { projectColorKeySchema, projectStatusSchema } from './projects.js';

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
    priority: taskPrioritySchema.default('MEDIUM'),
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

export const versionCommandSchema = z.object({ version: z.number().int().positive() }).strict();

export const taskProjectSummarySchema = z
  .object({
    id: projectIdSchema,
    name: z.string().min(1).max(40),
    colorKey: projectColorKeySchema,
    status: projectStatusSchema,
  })
  .strict();

export const taskSchema = z
  .object({
    id: taskIdSchema,
    userId: userIdSchema,
    projectId: projectIdSchema.nullable(),
    project: taskProjectSummarySchema.nullable(),
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
  .strict()
  .superRefine((task, context) => {
    if (task.projectId === null && task.project !== null) {
      context.addIssue({
        code: 'custom',
        message: '无项目待办不能包含项目摘要',
        path: ['project'],
      });
    }

    if (task.projectId !== null && task.project?.id !== task.projectId) {
      context.addIssue({
        code: 'custom',
        message: '项目摘要必须与 projectId 一致',
        path: ['project'],
      });
    }
  });

export const taskListQuerySchema = z
  .object({
    projectId: projectIdSchema.optional(),
    status: taskStatusSchema.default('TODO'),
    cursor: taskIdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export const taskListResponseSchema = z
  .object({
    items: z.array(taskSchema),
    pageInfo: z.object({ nextCursor: taskIdSchema.nullable() }).strict(),
    counts: z
      .object({
        todo: z.number().int().nonnegative(),
        completed: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const taskMutationResponseSchema = z.object({ task: taskSchema }).strict();

export const taskDeleteResponseSchema = z
  .object({
    task: taskSchema,
    undoOperation: z
      .object({
        id: undoOperationIdSchema,
        expiresAt: utcDateTimeSchema,
      })
      .strict(),
  })
  .strict();

export const undoExecutionResponseSchema = z
  .object({
    task: taskSchema,
    undoOperation: z
      .object({
        id: undoOperationIdSchema,
        status: z.literal('EXECUTED'),
        executedAt: utcDateTimeSchema,
      })
      .strict(),
  })
  .strict();

export type Task = z.infer<typeof taskSchema>;
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;
export type VersionCommand = z.infer<typeof versionCommandSchema>;
export type TaskProjectSummary = z.infer<typeof taskProjectSummarySchema>;
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;
export type TaskListResponse = z.infer<typeof taskListResponseSchema>;
export type TaskMutationResponse = z.infer<typeof taskMutationResponseSchema>;
export type TaskDeleteResponse = z.infer<typeof taskDeleteResponseSchema>;
export type UndoExecutionResponse = z.infer<typeof undoExecutionResponseSchema>;
