'use client';

import { useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';

export function RecordingPlayer({ meetingId }: { meetingId: string }) {
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    setBusy(true); setError('');
    try {
      const path = await invoke<string>('get_meeting_audio_path', { meetingId });
      setSource(convertFileSrc(path));
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  }
  return <div className="mt-3">
    {source ? <audio aria-label="Saved meeting recording" className="w-full" controls preload="none" src={source}
      onError={() => setError('Could not play this audio format. Use Open recording folder to play the original file.')} />
      : <Button size="sm" variant="outline" disabled={busy} onClick={() => void load()}>{busy ? 'Loading recording…' : 'Listen to recording'}</Button>}
    {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
  </div>;
}
