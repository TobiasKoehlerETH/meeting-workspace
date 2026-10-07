'use client';

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Switch } from './ui/switch';
import { Input } from './ui/input';
import { Label } from './ui/label';

type Settings = { enabled: boolean; speaker_count: number };

export function SpeakerSettings({ disabled = false }: { disabled?: boolean }) {
  const [settings, setSettings] = useState<Settings>({ enabled: true, speaker_count: 0 });
  const [count, setCount] = useState('0');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let closed = false;
    invoke<Settings>('get_speaker_settings').then(value => {
      if (!closed) { setSettings(value); setCount(String(value.speaker_count)); }
    }).catch(() => { if (!closed) setError('Could not load speaker settings.'); })
      .finally(() => { if (!closed) setBusy(false); });
    return () => { closed = true; };
  }, []);

  async function save(next: Settings) {
    setBusy(true); setError('');
    try { await invoke('set_speaker_settings', { settings: next }); setSettings(next); }
    catch { setError('Could not save speaker settings. Please try again.'); }
    finally { setBusy(false); }
  }

  return <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor="speaker-detection">Identify speakers locally</Label>
      <Switch id="speaker-detection" checked={settings.enabled} disabled={disabled || busy}
        onCheckedChange={enabled => void save({ ...settings, enabled })} />
    </div>
    <p className="text-sm text-gray-600">When you click Transcribe, group voices locally as Speaker 1, Speaker 2, and so on. Rename speakers in the transcript. Labels can be wrong, especially when people talk over each other.</p>
    <Label htmlFor="speaker-count">Number of speakers</Label>
    <Input id="speaker-count" type="number" min={0} max={20} step={1} value={count}
      disabled={disabled || busy || !settings.enabled} aria-describedby="speaker-count-help"
      onChange={event => setCount(event.target.value)} onBlur={() => {
        const value = Number(count);
        if (!count.trim() || !Number.isInteger(value) || value < 0 || value > 20) {
          setError('Enter 0 for Auto, or a whole number from 1 to 20.'); return;
        }
        if (value !== settings.speaker_count) void save({ ...settings, speaker_count: value });
      }} />
    <p id="speaker-count-help" className="text-xs text-gray-500">0 estimates automatically. A known count can improve grouping. Applies to new and retranscribed meetings; retranscribing resets speaker names.</p>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
  </div>;
}
