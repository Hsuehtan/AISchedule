import { z, type ZodType } from 'zod';

const deepSeekResponseSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            message: z.object({ content: z.string() }).passthrough(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

export interface DeepSeekProviderConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
}

export interface StructuredCompletionRequest {
  readonly model: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly timeoutMs: number;
}

export class ProviderHttpError extends Error {
  constructor(readonly status: number) {
    super(`DeepSeek request failed with HTTP ${status}`);
    this.name = 'ProviderHttpError';
  }
}

export class ProviderOutputError extends Error {
  constructor(options?: ErrorOptions) {
    super('DeepSeek returned invalid structured output', options);
    this.name = 'ProviderOutputError';
  }
}

export class DeepSeekProvider {
  constructor(
    private readonly config: DeepSeekProviderConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async completeStructured<T>(
    request: StructuredCompletionRequest,
    outputSchema: ZodType<T>,
  ): Promise<T> {
    const response = await this.fetchImpl(
      `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: request.model,
          messages: [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.userPrompt },
          ],
          response_format: { type: 'json_object' },
          stream: false,
        }),
        signal: AbortSignal.timeout(request.timeoutMs),
      },
    );

    if (!response.ok) {
      throw new ProviderHttpError(response.status);
    }

    try {
      const envelope = deepSeekResponseSchema.parse(await response.json());
      const payload = JSON.parse(envelope.choices[0]!.message.content) as unknown;
      return outputSchema.parse(payload);
    } catch (error) {
      throw new ProviderOutputError({ cause: error });
    }
  }
}
