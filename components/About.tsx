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
        <p className="text-base">Record audio. Create transcripts and summaries.</p>
      </header>
      <div className="grid grid-cols-2 gap-4">
        <section className="bg-gray-100 p-4 rounded">
          <h3 className="font-semibold mb-2">Recordings and transcripts</h3>
          <p className="text-sm">Record microphone and system audio. Transcribe locally.</p>
        </section>
        <section className="bg-gray-100 p-4 rounded">
          <h3 className="font-semibold mb-2">Notes and summaries</h3>
          <p className="text-sm">Keep notes, transcripts, and summaries together.</p>
        </section>
      </div>
      <p className="text-sm text-gray-600">Files stay on this device. Summaries use your selected AI provider.</p>
    </div>
  );
}
