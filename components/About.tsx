import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';

export function About() {
  const [version, setVersion] = useState('0.4.0');
  useEffect(() => { getVersion().then(setVersion).catch(console.error); }, []);
  return (
    <div className="p-4 space-y-6">
      <header className="space-y-2">
        <h2 className="text-2xl">Meeting Workspace</h2>
        <p className="text-sm text-gray-500">Version {version}</p>
        <p className="text-base">Record, transcribe, and summarize your meetings.</p>
      </header>
      <div className="grid grid-cols-2 gap-4">
        <section className="bg-gray-100 p-4 rounded">
          <h3 className="font-semibold mb-2">Recordings and transcripts</h3>
          <p className="text-sm">Capture microphone and system audio, then transcribe with local speech models.</p>
        </section>
        <section className="bg-gray-100 p-4 rounded">
          <h3 className="font-semibold mb-2">Notes and summaries</h3>
          <p className="text-sm">Keep meeting notes, transcripts, and summaries together in one workspace.</p>
        </section>
      </div>
      <p className="text-sm text-gray-600">Recordings and notes are stored on this device. AI summaries use the provider you choose in Settings.</p>
    </div>
  );
}
