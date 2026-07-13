import { describe, expect, it, vi } from 'vitest';

import {
  SpeechInputError,
  TencentSpeechProvider,
  type TencentSentenceRecognitionClient,
} from './tencent-speech.provider.js';

describe('TencentSpeechProvider', () => {
  it('maps supported audio into SentenceRecognition without persisting it', async () => {
    const sentenceRecognition = vi.fn().mockResolvedValue({
      Result: '把周报安排在明天上午。',
      RequestId: 'tencent-request-1',
      AudioDuration: 1_200,
    });
    const client: TencentSentenceRecognitionClient = {
      SentenceRecognition: sentenceRecognition,
    };
    const provider = new TencentSpeechProvider(client, {
      maxDurationMs: 60_000,
      maxEncodedBytes: 3_145_728,
    });

    await expect(
      provider.transcribe({
        audio: new Uint8Array([1, 2, 3, 4]),
        durationMs: 1_200,
        format: 'wav',
      }),
    ).resolves.toEqual({
      text: '把周报安排在明天上午。',
      providerRequestId: 'tencent-request-1',
      durationMs: 1_200,
    });

    expect(sentenceRecognition).toHaveBeenCalledWith(
      expect.objectContaining({
        EngSerViceType: '16k_zh',
        SourceType: 1,
        VoiceFormat: 'wav',
        Data: 'AQIDBA==',
        DataLen: 4,
      }),
    );
  });

  it('rejects overlong or oversized input before calling Tencent', async () => {
    const sentenceRecognition = vi.fn();
    const provider = new TencentSpeechProvider(
      { SentenceRecognition: sentenceRecognition },
      { maxDurationMs: 60_000, maxEncodedBytes: 16 },
    );

    await expect(
      provider.transcribe({
        audio: new Uint8Array([1]),
        durationMs: 60_001,
        format: 'wav',
      }),
    ).rejects.toBeInstanceOf(SpeechInputError);

    await expect(
      provider.transcribe({
        audio: new Uint8Array(13),
        durationMs: 1_000,
        format: 'wav',
      }),
    ).rejects.toBeInstanceOf(SpeechInputError);

    expect(sentenceRecognition).not.toHaveBeenCalled();
  });
});
