'use client';

import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Check, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  MODEL_SPECS, ModelStatus, SpeechModel, SpeechProvider, formatSize, modelLabel, speechModelApi, speechModelEvent,
} from '@/lib/speech-models';
import { formatEstimate, useTranscriptionEstimate } from '@/lib/transcription-estimate';

interface Props { provider: SpeechProvider; selectedModel?: string; onSelect: (model: string) => void }

const HOUR = 3600;

/** Lists one provider's local speech models with download state and expected processing time. */
export function SpeechModelManager({ provider, selectedModel, onSelect }: Props) {
  const api = speechModelApi(provider);
  const estimate = useTranscriptionEstimate();
  const [models, setModels] = useState<SpeechModel[] | null>(null);
  const [error, setError] = useState('');
  const setStatus = (name: string, status: ModelStatus) =>
    setModels(list => list?.map(model => model.name === name ? { ...model, status } : model) ?? list);

  useEffect(() => {
    let open = true;
    api.list().then(list => { if (open) setModels(list); })
      .catch(reason => { if (open) setError(String(reason)); });
    const listeners = [
      listen<{ modelName: string; progress: number }>(speechModelEvent(provider, 'progress'), ({ payload }) =>
        setStatus(payload.modelName, { Downloading: Math.round(payload.progress) })),
      listen<{ modelName: string }>(speechModelEvent(provider, 'complete'), ({ payload }) => {
        setStatus(payload.modelName, 'Available');
        toast.success(`${modelLabel(payload.modelName)} is ready`);
      }),
      listen<{ modelName: string; error: string }>(speechModelEvent(provider, 'error'), ({ payload }) => {
        setStatus(payload.modelName, { Error: payload.error });
        toast.error(`Could not download ${modelLabel(payload.modelName)}`, { description: payload.error });
      }),
    ];
    return () => { open = false; listeners.forEach(listener => void listener.then(unlisten => unlisten())); };
  }, [provider]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(name: string, action: () => Promise<unknown>, next: ModelStatus) {
    try { setStatus(name, next); await action(); }
    catch (reason) { setStatus(name, { Error: String(reason) }); }
  }

  // Save before notifying: listeners reload the saved config.
  async function select(name: string) {
    try { await api.select(name); onSelect(name); }
    catch (reason) { toast.error('Could not save the model choice', { description: String(reason) }); }
  }

  if (error) return <p role="alert" className="text-sm text-red-700">Could not load models: {error}</p>;
  if (!models) return <p className="text-sm text-gray-500" role="status">Loading models…</p>;

  const row = (model: SpeechModel) => {
    const spec = MODEL_SPECS[model.name];
    const { status } = model;
    const ready = status === 'Available';
    const progress = typeof status === 'object' && 'Downloading' in status ? status.Downloading : null;
    const hour = estimate(model.name, HOUR);
    const selected = ready && selectedModel === model.name;
    return <li key={model.name} className={`flex items-center gap-3 rounded border px-3 py-2 ${selected ? 'border-gray-900' : 'border-gray-200'}`}>
      <button type="button" disabled={!ready} onClick={() => void select(model.name)} aria-pressed={selected}
        className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default">
        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300'}`}>
          {selected && <Check className="h-3 w-3" aria-hidden="true" />}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{modelLabel(model.name)}</span>
          <span className="block text-xs text-gray-500">{spec?.note ?? model.name} · {formatSize(model.size_mb)}</span>
        </span>
      </button>
      <span className="shrink-0 text-right text-xs tabular-nums text-gray-600" title={hour.measured ? 'Based on transcriptions on this device' : 'Estimate; it adapts after you transcribe on this device'}>
        {formatEstimate(hour)}/h
      </span>
      <span className="w-24 shrink-0 text-right text-xs">
        {progress !== null ? <button type="button" className="text-gray-600 hover:text-red-700" onClick={() => void run(model.name, () => api.cancel(model.name), 'Missing')}>{progress}% · Cancel</button>
          : ready ? <button type="button" aria-label={`Delete ${modelLabel(model.name)}`} title="Delete to free space" className="p-1 text-gray-400 hover:text-red-700"
            onClick={() => void run(model.name, () => api.remove(model.name), 'Missing')}><Trash2 className="h-4 w-4" /></button>
          : <button type="button" className="rounded bg-gray-900 px-2 py-1 font-medium text-white hover:bg-gray-700"
            onClick={() => void run(model.name, () => api.download(model.name), { Downloading: 0 })}>
            {status === 'Missing' ? 'Download' : 'Retry'}</button>}
      </span>
    </li>;
  };

  const advanced = models.filter(model => !MODEL_SPECS[model.name] || MODEL_SPECS[model.name].advanced);
  return <div className="space-y-2">
    <ul className="space-y-2">{models.filter(model => !advanced.includes(model)).map(row)}</ul>
    {advanced.length > 0 && <details>
      <summary className="cursor-pointer py-2 text-sm text-gray-600">More models</summary>
      <ul className="space-y-2">{advanced.map(row)}</ul>
    </details>}
  </div>;
}
