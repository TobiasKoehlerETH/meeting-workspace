import { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { ModelManager } from './WhisperModelManager';
import { ParakeetModelManager } from './ParakeetModelManager';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useConfig } from '@/contexts/ConfigContext';
import { LanguageSelection } from './LanguageSelection';
import { SpeakerSettings } from './SpeakerSettings';

export interface TranscriptModelProps {
    provider: 'localWhisper' | 'parakeet';
    model: string;
    apiKey?: string | null;
}
export interface TranscriptSettingsProps {
    transcriptModelConfig: TranscriptModelProps;
    setTranscriptModelConfig: (config: TranscriptModelProps) => void;
    onModelSelect?: () => void;
}
export function TranscriptSettings({ transcriptModelConfig, setTranscriptModelConfig, onModelSelect }: TranscriptSettingsProps) {
    const { isRecording, isProcessing } = useRecordingState();
    const { selectedLanguage, setSelectedLanguage } = useConfig();
    const [provider, setProvider] = useState(transcriptModelConfig.provider);
    const disabled = isRecording || isProcessing;
    const selectModel = (model: string) => {
        setTranscriptModelConfig({ provider, model, apiKey: null });
        window.dispatchEvent(new CustomEvent('transcript-config-updated'));
        onModelSelect?.();
    };
    return <div className="space-y-4 pb-6">
        <SpeakerSettings disabled={disabled} />
        <p className="text-sm text-gray-600">Recording saves audio only. Transcription runs locally when you select a saved meeting and click Transcribe. New setups use quantized Whisper Turbo; Parakeet is also available.</p>
        <Select value={provider} onValueChange={value => setProvider(value as TranscriptModelProps['provider'])} disabled={disabled}>
            <SelectTrigger aria-label="Local speech model"><SelectValue /></SelectTrigger>
            <SelectContent>
                <SelectItem value="localWhisper">Whisper · Multilingual</SelectItem>
                <SelectItem value="parakeet">Parakeet · Faster processing</SelectItem>
            </SelectContent>
        </Select>
        <LanguageSelection selectedLanguage={selectedLanguage} onLanguageChange={setSelectedLanguage} disabled={disabled} provider={provider} />
        {!disabled && (provider === 'localWhisper'
            ? <ModelManager selectedModel={transcriptModelConfig.provider === provider ? transcriptModelConfig.model : undefined} onModelSelect={selectModel} autoSave />
            : <ParakeetModelManager selectedModel={transcriptModelConfig.provider === provider ? transcriptModelConfig.model : undefined} onModelSelect={selectModel} autoSave />)}
        {disabled && <p className="text-sm text-gray-600">Wait for recording and transcription to finish before changing models.</p>}
    </div>;
}
