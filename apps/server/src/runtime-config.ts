import { resolve } from 'node:path';

import { loadPointsConfig, loadSpeechProviderConfig } from '@ai-schedule/config';

export function loadRuntimeConfiguration(
  configRoot = process.env.AI_SCHEDULE_CONFIG_ROOT ?? resolve(process.cwd(), '../../config'),
) {
  return {
    points: loadPointsConfig(resolve(configRoot, 'product/points.yaml')),
    speech: loadSpeechProviderConfig(resolve(configRoot, 'providers/speech.yaml')),
  } as const;
}
