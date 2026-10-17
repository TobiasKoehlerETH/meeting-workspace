'use client';

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Switch } from './ui/switch';

export function LaunchSettings() {
  return <div className="space-y-4">
    <LaunchPreference name="start_minimized" title="Start minimized"
      description="Open in the tray. Use Open Main Window to return." />
    <LaunchPreference name="stealth_mode" title="Discreet launch"
      description="Open in the tray with notifications off. Start recording manually. System microphone indicators remain visible." />
  </div>;
}

function LaunchPreference({ name, title, description }: {
  name: 'start_minimized' | 'stealth_mode'; title: string; description: string;
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

  return <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
    <div className="flex items-center justify-between gap-4">
      <div>
        <h3 className="mb-2 text-lg font-semibold text-gray-900">{title}</h3>
        <p id={`${name}-help`} className="text-sm text-gray-600">{description}</p>
      </div>
      <Switch aria-label={title} aria-describedby={`${name}-help`}
        checked={enabled} disabled={busy} onCheckedChange={savePreference} />
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
  </div>;
}
