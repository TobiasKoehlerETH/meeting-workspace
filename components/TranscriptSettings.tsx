import { useState } from 'react';
import { SpeechModelManager } from './SpeechModelManager';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useConfig } from '@/contexts/ConfigContext';
import { LanguageSelection } from './LanguageSelection';
import { SpeakerSettings } from './SpeakerSettings';
import type { SpeechProvider } from '@/lib/speech-models';

export interface TranscriptModelProps {
    provider: SpeechProvider;
    model: string;
    apiKey?: string | null;
}

export function TranscriptSettings({ onModelSelect }: { onModelSelect?: () => void }) {
    const { isRecording, isProcessing } = useRecordingState();
    const { selectedLanguage, setSelectedLanguage, transcriptModelConfig, setTranscriptModelConfig } = useConfig();
    const [provider, setProvider] = useState(transcriptModelConfig.provider);
    const disabled = isRecording || isProcessing;
    const selectModel = (model: string) => {
        setTranscriptModelConfig({ provider, model, apiKey: null });
        window.dispatchEvent(new CustomEvent('transcript-config-updated'));
        onModelSelect?.();
    };
    return <div className="space-y-4 pb-6">
        <div role="radiogroup" aria-label="Speech engine" className="inline-flex rounded border border-gray-300 p-0.5 text-sm">
            {([['localWhisper', 'Whisper', 'Most accurate'], ['parakeet', 'Parakeet', 'Fastest']] as const).map(([value, label, hint]) =>
                <button key={value} type="button" role="radio" aria-checked={provider === value} disabled={disabled} title={hint}
                    onClick={() => setProvider(value)}
                    className={`rounded px-3 py-1 ${provider === value ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'}`}>{label}</button>)}
        </div>
        {disabled
            ? <p className="text-sm text-gray-500">Locked while recording</p>
            : <SpeechModelManager key={provider} provider={provider} onSelect={selectModel}
                selectedModel={transcriptModelConfig.provider === provider ? transcriptModelConfig.model : undefined} />}
        <LanguageSelection selectedLanguage={selectedLanguage} onLanguageChange={setSelectedLanguage} disabled={disabled} provider={provider} />
        <SpeakerSettings disabled={disabled} />
    </div>;
}
