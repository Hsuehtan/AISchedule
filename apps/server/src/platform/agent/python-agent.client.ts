import {
  executeRequestSchema,
  executeResponseSchema,
  MAX_PROJECT_CANDIDATES,
  MAX_TASK_CANDIDATES,
  MESSAGE_CONTENT_MAX_BYTES,
  type CandidateContext,
  type ExecuteRequest,
  type ExecuteResponse,
  type ExecuteResult,
} from '@ai-schedule/contracts/internal-agent/v1';

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
const ACTION_OPERATIONS = {
  CREATE_PROJECT_TASKS: new Set(['CREATE_PROJECT_TASKS']),
  CREATE_TASK: new Set(['CREATE_TASK']),
  ORGANIZE_TASKS: new Set(['ORGANIZE_TASK']),
  UPDATE_TASK: new Set(['UPDATE_TASK']),
  COMPLETE_TASK: new Set(['COMPLETE_TASK']),
  RESTORE_TASK: new Set(['RESTORE_TASK']),
  DELETE_TASK: new Set(['DELETE_TASK']),
} as const;

function isValidServiceToken(token: string): boolean {
  if (!SERVICE_TOKEN_PATTERN.test(token)) return false;
  try {
    const decoded = Buffer.from(token, 'base64url');
    return decoded.byteLength >= 32 && decoded.toString('base64url') === token;
  } catch {
    return false;
  }
}

function assertUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) throw new Error('Duplicate reference');
}

function validateRequestContext(request: ExecuteRequest): void {
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

function candidateMap(request: ExecuteRequest): ReadonlyMap<string, CandidateContext> {
  return new Map(request.candidates.map((candidate) => [candidate.candidateRef, candidate]));
}

function validateResultReferences(request: ExecuteRequest, result: ExecuteResult): void {
  if (!request.allowedResultTypes.includes(result.type)) {
    throw new Error('Result type was not allowed');
  }

  const candidates = candidateMap(request);
  const requireCandidate = (
    reference: string,
    kind: CandidateContext['kind'],
    expectedVersion?: number,
  ): CandidateContext => {
    const candidate = candidates.get(reference);
    if (
      !candidate ||
      candidate.kind !== kind ||
      candidate.version !== (expectedVersion ?? candidate.version)
    ) {
      throw new Error('Untrusted candidate reference');
    }
    return candidate;
  };
  const validateProject = (project: { type: string; candidateRef?: string }): void => {
    if (project.type === 'EXISTING') requireCandidate(project.candidateRef ?? '', 'PROJECT');
  };

  switch (result.type) {
    case 'REPLY':
    case 'CLARIFICATION':
      if (result.type === 'CLARIFICATION') {
        assertUnique(result.options.map(({ optionId }) => optionId));
      }
      return;
    case 'CANDIDATES':
      assertUnique(result.options.map(({ optionId }) => optionId));
      assertUnique(result.options.map(({ candidateRef }) => candidateRef));
      for (const option of result.options) {
        if (!candidates.has(option.candidateRef)) throw new Error('Untrusted candidate reference');
      }
      return;
    case 'PLAN':
      validateProject(result.project);
      assertUnique(result.tasks.map(({ clientRef }) => clientRef));
      return;
    case 'ACTION_PROPOSAL': {
      if (
        (result.actionCode === 'CREATE_TASK' || result.actionCode === 'CREATE_PROJECT_TASKS') &&
        result.mutations.length !== 1
      ) {
        throw new Error('Create actions require exactly one mutation');
      }
      const allowedOperations = ACTION_OPERATIONS[result.actionCode];
      const targetReferences: string[] = [];
      const draftReferences: string[] = [];
      for (const mutation of result.mutations) {
        if (!(allowedOperations as ReadonlySet<string>).has(mutation.operation)) {
          throw new Error('Action code does not match mutation');
        }
        switch (mutation.operation) {
          case 'CREATE_TASK':
            validateProject(mutation.project);
            draftReferences.push(mutation.task.clientRef);
            break;
          case 'CREATE_PROJECT_TASKS':
            validateProject(mutation.project);
            draftReferences.push(...mutation.tasks.map(({ clientRef }) => clientRef));
            break;
          case 'ORGANIZE_TASK':
            requireCandidate(mutation.targetRef, 'TASK', mutation.expectedVersion);
            requireCandidate(mutation.projectRef, 'PROJECT');
            targetReferences.push(mutation.targetRef);
            break;
          case 'UPDATE_TASK':
            requireCandidate(mutation.targetRef, 'TASK', mutation.expectedVersion);
            targetReferences.push(mutation.targetRef);
            break;
          case 'COMPLETE_TASK':
          case 'RESTORE_TASK':
          case 'DELETE_TASK':
            requireCandidate(mutation.targetRef, 'TASK', mutation.expectedVersion);
            targetReferences.push(mutation.targetRef);
            break;
        }
      }
      assertUnique(targetReferences);
      assertUnique(draftReferences);
    }
  }
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
      request = executeRequestSchema.parse(untrustedRequest);
      validateRequestContext(request);
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
      response = await this.fetchImpl(`${this.baseUrl}/internal/v1/agent/execute`, {
        body,
        headers: {
          authorization: `Bearer ${this.config.serviceToken}`,
          'content-type': 'application/json',
          'x-request-id': request.requestId,
        },
        method: 'POST',
        signal: AbortSignal.timeout(Math.min(configuredTimeout, remainingMs)),
      });
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
      const parsed = executeResponseSchema.parse(
        await readJsonWithinLimit(response, this.maxResponseBytes),
      );
      if (parsed.requestId !== request.requestId) {
        throw new Error('Agent response request id does not match');
      }
      validateResultReferences(request, parsed.result);
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
