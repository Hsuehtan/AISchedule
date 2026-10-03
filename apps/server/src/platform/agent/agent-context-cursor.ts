import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { ApiHttpException } from '../http/api-http.exception.js';

/** Opaque pagination only: no user-visible or model-visible database identifiers. */
export class AgentContextCursor {
  private readonly key: Buffer;
  constructor(token: string) {
    this.key = createHash('sha256').update(`agent-context-cursor-v2:${token}`).digest();
  }
  encode(requestId: string, resource: string, offset: number): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(`${requestId}:${resource}`));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify({ offset })), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
  }
  decode(cursor: string | null | undefined, requestId: string, resource: string): number {
    if (!cursor) return 0;
    try {
      const data = Buffer.from(cursor, 'base64url');
      if (data.length < 29 || data.toString('base64url') !== cursor) throw new Error('cursor');
      const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
      decipher.setAAD(Buffer.from(`${requestId}:${resource}`));
      decipher.setAuthTag(data.subarray(12, 28));
      const value = JSON.parse(
        Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString(),
      ) as { offset?: unknown };
      if (
        typeof value.offset !== 'number' ||
        !Number.isSafeInteger(value.offset) ||
        value.offset < 0
      )
        throw new Error('cursor');
      return value.offset;
    } catch {
      throw new ApiHttpException(409, 'AGENT_CONTEXT_UNAVAILABLE', '上下文游标不可用');
    }
  }
}
