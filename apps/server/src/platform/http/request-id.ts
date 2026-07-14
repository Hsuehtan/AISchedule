import { randomBytes } from 'node:crypto';

import type { FastifyRequest } from 'fastify';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9]{1,64}$/;

export interface RequestWithPublicId {
  readonly headers: FastifyRequest['headers'];
  publicRequestId?: string;
}

export function installRequestId(
  request: RequestWithPublicId,
  reply: { header(name: string, value: string): unknown },
): void {
  const supplied = request.headers['x-request-id'];
  const candidate =
    typeof supplied === 'string' && REQUEST_ID_PATTERN.test(supplied) ? supplied : undefined;
  const requestId = `req_${candidate ?? randomBytes(12).toString('hex')}`;

  request.publicRequestId = requestId;
  reply.header('x-request-id', requestId);
}

export function getRequestId(request: RequestWithPublicId): string {
  return request.publicRequestId ?? `req_${randomBytes(12).toString('hex')}`;
}
