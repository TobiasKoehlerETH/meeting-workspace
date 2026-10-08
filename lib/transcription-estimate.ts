import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { MODEL_SPECS } from '@/lib/speech-models';

export interface Hardware { cpu_cores: number; gpu_backend: string }
export interface Timing { model: string; audio: number; elapsed: number; speakers: boolean }
export interface Estimate { seconds: number; measured: boolean }

const TIMINGS_KEY = 'transcription-timings';
const SPEAKER_RTF = 0.04; // pyannote segmentation + TitaNet embeddings on CPU
const GPU_SPEEDUP: Record<string, number> = { Cuda: 0.15, Metal: 0.15, Vulkan: 0.25, HipBlas: 0.25 };

/** Model-only estimate before calibration: load time plus processing time scaled to this device. */
function baseline(model: string, audio: number, speakers: boolean, hardware?: Hardware) {
  const spec = MODEL_SPECS[model];
  const cpu = Math.min(2.5, Math.max(0.6, (8 / (hardware?.cpu_cores || 8)) ** 0.7));
  const gpu = spec?.provider === 'localWhisper' ? GPU_SPEEDUP[hardware?.gpu_backend ?? ''] : undefined;
  const speech = audio * (spec?.rtf ?? 0.5) * (gpu ?? cpu);
  return 2 + (spec?.size_mb ?? 500) / 500 + speech + (speakers ? audio * SPEAKER_RTF * cpu : 0);
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** Measured runs on this device correct the baseline: same-model runs first, else all runs. */
export function estimateTranscription(model: string, audio: number, speakers: boolean,
  hardware?: Hardware, timings: Timing[] = loadTimings()): Estimate {
  const usable = timings.filter(t => t.audio >= 30);
  const sameModel = usable.filter(t => t.model === model);
  const runs = sameModel.length ? sameModel : usable;
  const correction = runs.length
    ? Math.min(5, Math.max(0.2, median(runs.map(t => t.elapsed / baseline(t.model, t.audio, t.speakers, hardware)))))
    : 1;
  return { seconds: baseline(model, audio, speakers, hardware) * correction, measured: sameModel.length > 0 };
}

/** "~4 min" while uncalibrated, "4 min" once measured on this device. */
export function formatEstimate({ seconds, measured }: Estimate) {
  if (seconds < 60) return 'under 1 min';
  const minutes = Math.round(seconds / 60);
  return (measured ? '' : '~') + (minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`);
}

export function loadTimings(): Timing[] {
  try { return JSON.parse(localStorage.getItem(TIMINGS_KEY) || '[]'); } catch { return []; }
}

export function recordTiming(timing: Timing) {
  try { localStorage.setItem(TIMINGS_KEY, JSON.stringify([...loadTimings(), timing].slice(-20))); } catch { /* estimates stay uncalibrated */ }
}

let hardwareRequest: Promise<Hardware | undefined> | undefined;

/** Loads hardware once per session and the speaker setting per mount (it changes in Settings). */
export function useTranscriptionEstimate() {
  const [hardware, setHardware] = useState<Hardware>();
  const [speakers, setSpeakers] = useState(true);
  useEffect(() => {
    let open = true;
    hardwareRequest ??= invoke<Hardware>('get_transcription_hardware').catch(() => undefined);
    void hardwareRequest.then(value => { if (open) setHardware(value); });
    invoke<{ enabled: boolean }>('get_speaker_settings')
      .then(value => { if (open) setSpeakers(value.enabled); }).catch(() => {});
    return () => { open = false; };
  }, []);
  return (model: string, audio: number) => estimateTranscription(model, audio, speakers, hardware);
}
