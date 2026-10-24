import { invoke } from '@tauri-apps/api/core';

export type SpeechProvider = 'localWhisper' | 'parakeet';
export type ModelStatus = 'Available' | 'Missing' | { Downloading: number } | { Error: string } | { Corrupted: unknown };
export interface SpeechModel { name: string; size_mb: number; status: ModelStatus }

interface ModelSpec {
  provider: SpeechProvider;
  label: string;
  note: string;
  size_mb: number;
  /** Rough CPU processing seconds per audio second; device timings correct it. */
  rtf: number;
  advanced?: true;
}

const whisper = (label: string, note: string, size_mb: number, rtf: number, advanced?: true): ModelSpec =>
  ({ provider: 'localWhisper', label, note, size_mb, rtf, advanced });
const parakeet = (label: string, note: string, size_mb: number, rtf: number): ModelSpec =>
  ({ provider: 'parakeet', label, note, size_mb, rtf });

/** Display order is declaration order. */
export const MODEL_SPECS: Record<string, ModelSpec> = {
  'large-v3-turbo-q5_0': whisper('Turbo', 'Recommended for English and German · fast', 547, 0.3),
  'large-v3-turbo-swiss-german-q5_0': whisper('Swiss German', 'Recommended for Swiss German · used automatically', 547, 0.3),
  'large-v3-q5_0': whisper('Large V3 compact', 'Most accurate · slower', 1031, 0.9),
  'large-v3': whisper('Large V3', 'Most accurate · slowest, most memory', 2951, 1.1),
  'medium-q5_0': whisper('Medium', 'Good accuracy', 514, 0.45),
  'small': whisper('Small', 'Fast · lower accuracy', 466, 0.18),
  'large-v3-turbo': whisper('Turbo full precision', 'Accurate · more memory', 1549, 0.35, true),
  'medium': whisper('Medium full precision', 'Good accuracy · more memory', 1463, 0.55, true),
  'small-q5_1': whisper('Small compact', 'Fast · lower accuracy', 181, 0.15, true),
  'base': whisper('Base', 'Very fast · basic accuracy', 142, 0.07, true),
  'base-q5_1': whisper('Base compact', 'Very fast · basic accuracy', 57, 0.06, true),
  'tiny': whisper('Tiny', 'Fastest · drafts only', 39, 0.04, true),
  'tiny-q5_1': whisper('Tiny compact', 'Fastest · drafts only', 31, 0.035, true),
  'parakeet-tdt-0.6b-v3-int8': parakeet('Lightning', 'Recommended · fastest, English and German', 670, 0.05),
  'parakeet-tdt-0.6b-v3-fp32': parakeet('Precise', 'Higher precision · more memory', 2554, 0.1),
  'parakeet-tdt-0.6b-v2-int8': parakeet('Compact', 'English only', 661, 0.05),
};

/** Swiss German speech always uses this model once downloaded (see `speech_model_for_language`). */
export const SWISS_GERMAN_MODEL = 'large-v3-turbo-swiss-german-q5_0';

export const modelLabel = (name: string) => MODEL_SPECS[name]?.label ?? name;

export const formatSize = (mb: number) => mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`;

/** Whisper commands are unprefixed; Parakeet commands and events carry its name. */
const command = (provider: SpeechProvider, action: string) =>
  provider === 'parakeet' ? `parakeet_${action}` : `whisper_${action}`;

export const speechModelEvent = (provider: SpeechProvider, event: 'progress' | 'complete' | 'error') =>
  `${provider === 'parakeet' ? 'parakeet-' : ''}model-download-${event}`;

export const speechModelApi = (provider: SpeechProvider) => ({
  list: async () => {
    await invoke(command(provider, 'init'));
    const models = await invoke<SpeechModel[]>(command(provider, 'get_available_models'));
    const order = Object.keys(MODEL_SPECS);
    const rank = (name: string) => order.includes(name) ? order.indexOf(name) : order.length;
    return models.sort((a, b) => rank(a.name) - rank(b.name));
  },
  download: (modelName: string) => invoke(command(provider, 'download_model'), { modelName }),
  cancel: (modelName: string) => invoke(command(provider, 'cancel_download'), { modelName }),
  remove: (modelName: string) => invoke(command(provider, 'delete_corrupted_model'), { modelName }),
  select: (model: string) => invoke('api_save_transcript_config', { provider, model, apiKey: null }),
});
