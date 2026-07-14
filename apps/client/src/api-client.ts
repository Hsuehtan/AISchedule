import { apiErrorEnvelopeSchema } from '@ai-schedule/contracts';

import { createIdempotencyKey } from './write-intent';

export type ApiTransportRequest = {
  body?: unknown;
  headers: Record<string, string>;
  method: 'DELETE' | 'GET' | 'PATCH' | 'POST';
  url: string;
};

export type ApiTransportResponse = {
  data: unknown;
  status: number;
};

export type ApiTransport = (request: ApiTransportRequest) => Promise<ApiTransportResponse>;

type ResponseParser<T> = { parse: (value: unknown) => T };

type ApiRequestOptions<T> = {
  body?: unknown;
  handleUnauthorized?: boolean;
  idempotencyKey?: string;
  idempotent?: boolean;
  method?: ApiTransportRequest['method'];
  query?: Record<string, boolean | number | string | undefined>;
  responseSchema: ResponseParser<T>;
};

type ApiClientOptions = {
  baseUrl: string;
  onUnauthorized?: () => void;
  transport: ApiTransport;
};

export class ApiRequestError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly requestId: string | null;
  readonly status: number;

  constructor(options: {
    code: string;
    details?: Record<string, unknown>;
    message: string;
    requestId?: string | null;
    status: number;
  }) {
    super(options.message);
    this.name = 'ApiRequestError';
    this.code = options.code;
    this.details = options.details ?? {};
    this.requestId = options.requestId ?? null;
    this.status = options.status;
  }
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

function withQuery(
  url: string,
  query: Record<string, boolean | number | string | undefined> | undefined,
): string {
  if (!query) return url;
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) parameters.set(key, String(value));
  }
  const serialized = parameters.toString();
  return serialized ? `${url}?${serialized}` : url;
}

export class ApiClient {
  readonly #baseUrl: string;
  readonly #onUnauthorized: (() => void) | undefined;
  readonly #transport: ApiTransport;

  constructor({ baseUrl, onUnauthorized, transport }: ApiClientOptions) {
    this.#baseUrl = baseUrl;
    this.#onUnauthorized = onUnauthorized;
    this.#transport = transport;
  }

  async request<T>(path: string, options: ApiRequestOptions<T>): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.idempotent) {
      headers['Idempotency-Key'] = options.idempotencyKey ?? createIdempotencyKey();
    }

    const response = await this.#transport({
      ...(options.body === undefined ? {} : { body: options.body }),
      headers,
      method: options.method ?? 'GET',
      url: withQuery(joinUrl(this.#baseUrl, path), options.query),
    });

    if (response.status === 401 && options.handleUnauthorized !== false) this.#onUnauthorized?.();
    if (response.status < 200 || response.status >= 300) {
      const parsedError = apiErrorEnvelopeSchema.safeParse(response.data);
      if (parsedError.success) {
        throw new ApiRequestError({
          code: parsedError.data.error.code,
          details: parsedError.data.error.details,
          message: parsedError.data.error.message,
          requestId: parsedError.data.error.requestId,
          status: response.status,
        });
      }
      throw new ApiRequestError({
        code: 'API_REQUEST_FAILED',
        message: '请求失败，请稍后重试',
        status: response.status,
      });
    }

    return options.responseSchema.parse(response.data);
  }
}
