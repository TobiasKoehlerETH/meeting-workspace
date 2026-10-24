'use client';

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Switch } from './ui/switch';

export function LaunchSettings() {
  return <div className="space-y-4">
    <LaunchPreference name="start_minimized" title="Start minimized"
      description="Open in the tray; use Open Main Window to return." />
  </div>;
}

function LaunchPreference({ name, title, description }: {
  name: 'start_minimized'; title: string; description: string;
}) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let closed = false;
    invoke<boolean>(`get_${name}`)
      .then(value => { if (!closed) setEnabled(value); })
      .catch(() => { if (!closed) setError('Could not load the launch preference.'); })
      .finally(() => { if (!closed) setBusy(false); });
    return () => { closed = true; };
  }, [name]);

  async function savePreference(value: boolean) {
    setBusy(true);
    setError('');
    try {
      await invoke(`set_${name}`, { enabled: value });
      setEnabled(value);
    } catch {
      setError('Could not save the launch preference. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="rounded-lg border border-gray-200 bg-white p-4">
    <div className="flex items-center justify-between gap-4">
      <h3 title={description}>{title}</h3>
      <Switch aria-label={title} aria-description={description}
        checked={enabled} disabled={busy} onCheckedChange={savePreference} />
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
  </div>;
}
