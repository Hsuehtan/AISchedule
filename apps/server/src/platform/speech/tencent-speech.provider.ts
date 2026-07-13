import { asr } from 'tencentcloud-sdk-nodejs-asr';

export type TencentSpeechFormat =
  | 'wav'
  | 'pcm'
  | 'ogg-opus'
  | 'speex'
  | 'silk'
  | 'mp3'
  | 'm4a'
  | 'aac'
  | 'amr';

export interface TencentSentenceRecognitionRequest {
  readonly EngSerViceType: string;
  readonly SourceType: number;
  readonly VoiceFormat: string;
  readonly Data: string;
  readonly DataLen: number;
  readonly WordInfo?: number;
  readonly ConvertNumMode?: number;
}

export interface TencentSentenceRecognitionResponse {
  readonly Result?: string;
  readonly RequestId?: string;
  readonly AudioDuration?: number;
}

export interface TencentSentenceRecognitionClient {
  SentenceRecognition(
    request: TencentSentenceRecognitionRequest,
  ): Promise<TencentSentenceRecognitionResponse>;
}

export interface SpeechProviderLimits {
  readonly maxDurationMs: number;
  readonly maxEncodedBytes: number;
}

export interface SpeechTranscriptionInput {
  readonly audio: Uint8Array;
  readonly durationMs: number;
  readonly format: TencentSpeechFormat;
}

export interface SpeechTranscriptionResult {
  readonly text: string;
  readonly providerRequestId: string;
  readonly durationMs: number;
}

export interface TencentSpeechClientConfig {
  readonly secretId: string;
  readonly secretKey: string;
  readonly region?: string;
  readonly timeoutSeconds?: number;
}

export class SpeechInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpeechInputError';
  }
}

export class SpeechProviderOutputError extends Error {
  constructor() {
    super('Tencent ASR returned an incomplete response');
    this.name = 'SpeechProviderOutputError';
  }
}

export function createTencentSentenceClient(
  config: TencentSpeechClientConfig,
): TencentSentenceRecognitionClient {
  const Client = asr.v20190614.Client;
  return new Client({
    credential: {
      secretId: config.secretId,
      secretKey: config.secretKey,
    },
    region: config.region ?? 'ap-shanghai',
    profile: {
      signMethod: 'TC3-HMAC-SHA256',
      httpProfile: {
        endpoint: 'asr.tencentcloudapi.com',
        reqMethod: 'POST',
        reqTimeout: config.timeoutSeconds ?? 30,
      },
    },
  });
}

export class TencentSpeechProvider {
  constructor(
    private readonly client: TencentSentenceRecognitionClient,
    private readonly limits: SpeechProviderLimits,
  ) {}

  async transcribe(
    input: SpeechTranscriptionInput,
  ): Promise<SpeechTranscriptionResult> {
    if (input.durationMs <= 0 || input.durationMs > this.limits.maxDurationMs) {
      throw new SpeechInputError('Audio duration exceeds the configured limit');
    }

    const encodedAudio = Buffer.from(input.audio).toString('base64');
    if (Buffer.byteLength(encodedAudio, 'utf8') > this.limits.maxEncodedBytes) {
      throw new SpeechInputError('Base64 audio exceeds the configured limit');
    }

    const response = await this.client.SentenceRecognition({
      EngSerViceType: '16k_zh',
      SourceType: 1,
      VoiceFormat: input.format,
      Data: encodedAudio,
      DataLen: input.audio.byteLength,
      WordInfo: 0,
      ConvertNumMode: 1,
    });

    if (!response.Result || !response.RequestId) {
      throw new SpeechProviderOutputError();
    }

    return {
      text: response.Result,
      providerRequestId: response.RequestId,
      durationMs: response.AudioDuration ?? input.durationMs,
    };
  }
}
