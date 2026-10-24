'use client';

import { useState, type ComponentType } from 'react';
import { FlaskConical, Mic, Settings2, Sparkles, AudioLines, type LucideIcon } from 'lucide-react';
import { TranscriptSettings } from '@/components/TranscriptSettings';
import { RecordingSettings } from '@/components/RecordingSettings';
import { PreferenceSettings } from '@/components/PreferenceSettings';
import { SummaryModelSettings } from '@/components/SummaryModelSettings';
import { BetaSettings } from '@/components/BetaSettings';
import type { SettingsTab } from '@/lib/utils';

const SECTIONS: [SettingsTab, string, LucideIcon, ComponentType][] = [
  ['general', 'General', Settings2, PreferenceSettings],
  ['recording', 'Recordings', Mic, RecordingSettings],
  ['transcription', 'Transcription', AudioLines, TranscriptSettings],
  ['summary', 'Summary', Sparkles, SummaryModelSettings],
  ['beta', 'Beta', FlaskConical, BetaSettings],
];

/** Section list on the left, the chosen section on the right; the dialog supplies the close button. */
export function SettingsPanel({ initialTab = 'general' }: { initialTab?: SettingsTab }) {
  const [active, setActive] = useState(initialTab);
  const [, label, , Content] = SECTIONS.find(([id]) => id === active)!;
  return <div className="ap-settings flex h-full min-h-0">
    <nav aria-label="Settings sections" className="flex w-44 shrink-0 flex-col gap-1 border-r border-gray-200 bg-gray-50 p-3">
      <p className="px-3 pb-3 pt-1 text-lg">Settings</p>
      {SECTIONS.map(([id, name, Icon]) => <button key={id} type="button" aria-current={id === active ? 'page' : undefined}
        onClick={() => setActive(id)}
        className={`flex items-center gap-3 rounded px-3 py-2 text-left text-sm ${id === active ? 'bg-white font-semibold shadow-sm' : 'text-gray-600 hover:bg-white'}`}>
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{name}
      </button>)}
    </nav>
    <section aria-label={label} className="min-w-0 flex-1 overflow-y-auto px-8 py-8">
      <h2 className="sr-only">{label}</h2>
      <Content />
    </section>
  </div>;
}
