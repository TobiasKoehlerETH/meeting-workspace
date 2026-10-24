'use client';

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function SpeakerNames({ meetingId, revision, onChanged }: {
  meetingId: string; revision: string; onChanged?: () => Promise<void>;
}) {
  const [speakers, setSpeakers] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let closed = false;
    setSpeakers([]); setSelected(''); setName(''); setError('');
    invoke<string[]>('list_meeting_speakers', { meetingId }).then(value => {
      if (!closed) { setSpeakers(value); setSelected(value[0] ?? ''); setName(value[0] ?? ''); }
    }).catch(() => { if (!closed) setError('Could not load speaker names.'); });
    return () => { closed = true; };
  }, [meetingId, revision]);

  async function rename() {
    setBusy(true); setError('');
    try {
      await invoke('rename_meeting_speaker', { meetingId, speaker: selected, name });
      await onChanged?.();
      setSpeakers(values => values.map(value => value === selected ? name.trim() : value));
      setSelected(name.trim());
    } catch (error) {
      const message = String(error);
      if (message.startsWith('Name saved in the app')) await onChanged?.();
      setError(message);
    } finally { setBusy(false); }
  }

  if (!speakers.length && !error) return null;
  return <details className="mt-3 text-sm">
    <summary className="cursor-pointer font-medium">Speakers</summary>
    <div className="mt-2 space-y-2">
      <p className="text-xs text-gray-500">Regenerate the summary to update names.</p>
      <select aria-label="Speaker to rename" className="w-full rounded border p-2" value={selected} disabled={busy}
        onChange={event => { setSelected(event.target.value); setName(event.target.value); }}>
        {speakers.map(speaker => <option key={speaker} value={speaker}>{speaker}</option>)}
      </select>
      <Input aria-label="Speaker name" value={name} maxLength={80} disabled={busy}
        onChange={event => setName(event.target.value)} />
      <Button size="sm" disabled={busy || !selected || !name.trim() || name.trim() === selected}
        onClick={() => void rename()}>Save name</Button>
      {error && <p role="alert" className="text-red-600">{error}</p>}
    </div>
  </details>;
}
