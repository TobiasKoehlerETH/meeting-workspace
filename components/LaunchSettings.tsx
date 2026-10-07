'use client';

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Switch } from './ui/switch';

export function LaunchSettings() {
  return <div className="space-y-4">
    <LaunchPreference name="start_minimized" title="Start minimized"
      description="Open in the system tray on the next launch. Use Open Main Window to return. Recording starts only when you choose Start Recording." />
    <LaunchPreference name="stealth_mode" title="Discreet launch (stealth mode)"
      description="On the next launch, keep the window hidden, silence app notifications, and use a neutral tray tooltip. Start, pause, and stop from the tray without opening the window. The tray menu and main window still show recording controls. Operating-system microphone indicators remain visible. Recording does not start automatically." />
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
