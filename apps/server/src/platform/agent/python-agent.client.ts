import {
  executeRequestSchema,
  executeResponseSchema,
  MAX_PROJECT_CANDIDATES,
  MAX_TASK_CANDIDATES,
  MESSAGE_CONTENT_MAX_BYTES,
} from '@ai-schedule/contracts/internal-agent/v1';
import {
  executeRequestSchema as v2RequestSchema,
  executeResponseSchema as v2ResponseSchema,
} from '@ai-schedule/contracts/internal-agent/v2';
import type { ExecuteRequest, ExecuteResponse } from '../../modules/agent/agent-runtime.port.js';
import { assertUnique, validateResultReferences } from './agent-result-validation.js';

export type AgentServiceClientErrorCode =
  | 'AUTHENTICATION_FAILED'
  | 'BUSY'
  | 'CONTRACT_REJECTED'
  | 'DEADLINE_EXPIRED'
  | 'INVALID_RESPONSE'
  | 'TIMEOUT'
  | 'UNAVAILABLE';

export class AgentServiceClientError extends Error {
  readonly status: number | undefined;

  constructor(
    readonly code: AgentServiceClientErrorCode,
    options: { cause?: unknown; status?: number } = {},
  ) {
    super(`Agent service request failed: ${code}`, { cause: options.cause });
    this.name = 'AgentServiceClientError';
    this.status = options.status;
  }
}

export type AgentServiceClientConfig = {
  baseUrl: string;
  maxBodyBytes?: number;
  maxResponseBytes?: number;
  planTimeoutMs?: number;
  serviceToken: string;
  standardTimeoutMs?: number;
};

export type AgentServiceFetch = (input: string, init: RequestInit) => Promise<Response>;

const SERVICE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,512}$/u;
function isValidServiceToken(token: string): boolean {
  if (!SERVICE_TOKEN_PATTERN.test(token)) return false;
  try {
    const decoded = Buffer.from(token, 'base64url');
    return decoded.byteLength >= 32 && decoded.toString('base64url') === token;
  } catch {
    return false;
  }
}

function validateRequestContext(
  request: Extract<ExecuteRequest, { contractVersion: '1.0' }>,
): void {
  const messageBytes = request.messages.reduce(
    (total, message) => total + Buffer.byteLength(message.content, 'utf8'),
    0,
  );
  if (messageBytes > MESSAGE_CONTENT_MAX_BYTES) throw new Error('Message context too large');

  const taskCount = request.candidates.filter(({ kind }) => kind === 'TASK').length;
  const projectCount = request.candidates.length - taskCount;
  if (taskCount > MAX_TASK_CANDIDATES || projectCount > MAX_PROJECT_CANDIDATES) {
    throw new Error('Candidate context too large');
  }
  assertUnique(request.candidates.map(({ candidateRef }) => candidateRef));
}

class ResponseTransportError extends Error {
  constructor(readonly code: 'TIMEOUT' | 'UNAVAILABLE') {
    super('Agent response transport failed');
    this.name = 'ResponseTransportError';
  }
}

async function readJsonWithinLimit(response: Response, maxBytes: number): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error('Response body too large');
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('Response body missing');
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    let read: ReadableStreamReadResult<Uint8Array>;
    try {
      read = await reader.read();
    } catch (error) {
      throw new ResponseTransportError(isAbortError(error) ? 'TIMEOUT' : 'UNAVAILABLE');
    }
    const { done, value } = read;
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('Response body too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
}

function errorForStatus(status: number): AgentServiceClientError {
  if (status === 401) {
    return new AgentServiceClientError('AUTHENTICATION_FAILED', { status });
  }
  if (status === 413 || status === 422) {
    return new AgentServiceClientError('CONTRACT_REJECTED', { status });
  }
  if (status === 429) return new AgentServiceClientError('BUSY', { status });
  if (status === 504) return new AgentServiceClientError('TIMEOUT', { status });
  return new AgentServiceClientError('UNAVAILABLE', { status });
}

async function cancelPrivateResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Body cleanup is best effort and must not alter the stable transport classification.
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

export class AgentServiceClient {
  private readonly baseUrl: string;
  private readonly maxBodyBytes: number;
  private readonly maxResponseBytes: number;
  private readonly planTimeoutMs: number;
  private readonly standardTimeoutMs: number;

  constructor(
    private readonly config: AgentServiceClientConfig,
    private readonly fetchImpl: AgentServiceFetch = (input, init) => fetch(input, init),
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!isValidServiceToken(config.serviceToken)) {
      const reason = config.serviceToken.length < 43 ? '256-bit entropy' : 'base64url characters';
      throw new Error(`Agent service token must use ${reason}`);
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/u, '');
    this.maxBodyBytes = config.maxBodyBytes ?? 256 * 1024;
    this.maxResponseBytes = config.maxResponseBytes ?? 256 * 1024;
    this.planTimeoutMs = config.planTimeoutMs ?? 65_000;
    this.standardTimeoutMs = config.standardTimeoutMs ?? 35_000;
  }

  async execute(untrustedRequest: ExecuteRequest): Promise<ExecuteResponse> {
    let request: ExecuteRequest;
    try {
      request =
        untrustedRequest.contractVersion === '2.0'
          ? v2RequestSchema.parse(untrustedRequest)
          : executeRequestSchema.parse(untrustedRequest);
      if (request.contractVersion === '1.0') validateRequestContext(request);
    } catch {
      throw new AgentServiceClientError('CONTRACT_REJECTED');
    }
    const remainingMs = new Date(request.deadlineAt).getTime() - this.now().getTime();
    if (remainingMs <= 0) throw new AgentServiceClientError('DEADLINE_EXPIRED');

    const body = JSON.stringify(request);
    if (new TextEncoder().encode(body).byteLength > this.maxBodyBytes) {
      throw new AgentServiceClientError('CONTRACT_REJECTED');
    }

    const configuredTimeout =
      request.capabilityCode === 'agent.planGeneration'
        ? this.planTimeoutMs
        : this.standardTimeoutMs;
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.baseUrl}/internal/v${request.contractVersion === '2.0' ? '2' : '1'}/agent/execute`,
        {
          body,
          headers: {
            authorization: `Bearer ${this.config.serviceToken}`,
            'content-type': 'application/json',
            'x-request-id': request.requestId,
          },
          method: 'POST',
          signal: AbortSignal.timeout(Math.min(configuredTimeout, remainingMs)),
        },
      );
    } catch (error) {
      throw new AgentServiceClientError(isAbortError(error) ? 'TIMEOUT' : 'UNAVAILABLE', {
        cause: error,
      });
    }

    if (!response.ok) {
      await cancelPrivateResponseBody(response);
      throw errorForStatus(response.status);
    }

    try {
      const parsed = (
        request.contractVersion === '2.0' ? v2ResponseSchema : executeResponseSchema
      ).parse(await readJsonWithinLimit(response, this.maxResponseBytes));
      if (parsed.requestId !== request.requestId) {
        throw new Error('Agent response request id does not match');
      }
      if (!request.allowedResultTypes.includes(parsed.result.type))
        throw new Error('Unexpected result type');
      if (request.contractVersion === '1.0') validateResultReferences(request, parsed.result);
      return parsed;
    } catch (error) {
      if (error instanceof ResponseTransportError) {
        throw new AgentServiceClientError(error.code);
      }
      // Never retain parse/Zod errors: Node error strings may include the private response body.
      throw new AgentServiceClientError('INVALID_RESPONSE');
    }
  }
}
