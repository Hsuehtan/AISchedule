import { z } from 'zod';

export const apiErrorCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/);
export const requestIdSchema = z.string().regex(/^req_[A-Za-z0-9]+$/);

export const apiErrorSchema = z
  .object({
    code: apiErrorCodeSchema,
    message: z.string().min(1),
    requestId: requestIdSchema,
    details: z.record(z.string(), z.unknown()),
  })
  .strict();

export const apiErrorEnvelopeSchema = z.object({ error: apiErrorSchema }).strict();

export type ApiError = z.infer<typeof apiErrorSchema>;
export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;
