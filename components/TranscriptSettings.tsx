import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { Eye, EyeOff } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { ModelManager } from './WhisperModelManager';
import { ParakeetModelManager } from './ParakeetModelManager';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useConfig } from '@/contexts/ConfigContext';
import { LanguageSelection } from './LanguageSelection';

export interface TranscriptModelProps {
    provider: 'localWhisper' | 'parakeet' | 'nemotron-parakeet' | 'openrouter' | 'deepgram' | 'elevenLabs' | 'groq' | 'openai';
    model: string;
    apiKey?: string | null;
}

export interface TranscriptSettingsProps {
    transcriptModelConfig: TranscriptModelProps;
    setTranscriptModelConfig: (config: TranscriptModelProps) => void;
    onModelSelect?: () => void;
}

const DEFAULT_API_MODEL = 'openai/whisper-large-v3-turbo';
const FALLBACK_MODELS = [
    { id: DEFAULT_API_MODEL, name: 'Whisper Large V3 Turbo · Fast, low cost' },
    { id: 'openai/gpt-4o-mini-transcribe', name: 'GPT-4o Mini Transcribe' },
    { id: 'openai/gpt-4o-transcribe', name: 'GPT-4o Transcribe' },
];

export function TranscriptSettings({ transcriptModelConfig, setTranscriptModelConfig, onModelSelect }: TranscriptSettingsProps) {
    const { isRecording } = useRecordingState();
    const { selectedLanguage, setSelectedLanguage } = useConfig();
    const [provider, setProvider] = useState(transcriptModelConfig.provider);
    const [model, setModel] = useState(transcriptModelConfig.provider === 'openrouter' ? transcriptModelConfig.model : DEFAULT_API_MODEL);
    const [apiKey, setApiKey] = useState('');
    const [showApiKey, setShowApiKey] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isLoadingKey, setIsLoadingKey] = useState(false);
    const [models, setModels] = useState(FALLBACK_MODELS);
    const [pipelineReady, setPipelineReady] = useState({ nemotron: false, parakeet: false });
    const [downloading, setDownloading] = useState(false);
    const refreshPipeline = () => invoke<typeof pipelineReady>('get_local_pipeline_status').then(setPipelineReady);
    useEffect(() => { if (provider === 'nemotron-parakeet') void refreshPipeline().catch(() => toast.error('Cannot check local models.')); }, [provider]);
    const setupPipeline = async () => {
        setDownloading(true);
        try {
            if (!pipelineReady.nemotron) await invoke('download_nemotron_model');
            if (!pipelineReady.parakeet) await invoke('parakeet_download_model', { modelName: 'parakeet-tdt-0.6b-v3-int8' });
            await refreshPipeline();
            toast.success('Local models downloaded.');
        } catch (error) { toast.error('Model download failed.', { description: String(error) }); }
        finally { setDownloading(false); }
    };
    const savePipeline = async () => {
        setIsSaving(true);
        try {
            const config: TranscriptModelProps = { provider: 'nemotron-parakeet', model: 'nemotron-3.5-streaming-int8', apiKey: null };
            await invoke('api_save_transcript_config', { ...config });
            setTranscriptModelConfig(config);
            window.dispatchEvent(new CustomEvent('transcript-config-updated'));
            toast.success('Local two-stage transcription enabled.');
        } catch (error) { toast.error('Cannot save transcription.', { description: String(error) }); }
        finally { setIsSaving(false); }
    };

    useEffect(() => {
        setProvider(transcriptModelConfig.provider);
        if (transcriptModelConfig.provider === 'openrouter') setModel(transcriptModelConfig.model);
    }, [transcriptModelConfig.provider, transcriptModelConfig.model]);

    useEffect(() => {
        if (provider !== 'openrouter') return;
        let cancelled = false;
        setIsLoadingKey(true);
        invoke<string>('api_get_transcript_api_key', { provider: 'openrouter' })
            .then(key => { if (!cancelled) setApiKey(key || ''); })
            .catch(() => { if (!cancelled) toast.error('Cannot load the saved API key.'); })
            .finally(() => { if (!cancelled) setIsLoadingKey(false); });
        invoke<typeof FALLBACK_MODELS>('get_openrouter_transcription_models')
            .then(list => { if (!cancelled && list.length) setModels(list); })
            .catch(() => { /* Keep built-in speech models when the catalog is offline. */ });
        return () => { cancelled = true; };
    }, [provider]);

    const selectLocalModel = (localProvider: 'localWhisper' | 'parakeet', modelName: string) => {
        setTranscriptModelConfig({ provider: localProvider, model: modelName, apiKey: null });
        window.dispatchEvent(new CustomEvent('transcript-config-updated'));
        onModelSelect?.();
    };

    const saveApiSettings = async () => {
        setIsSaving(true);
        try {
            const config: TranscriptModelProps = { provider: 'openrouter', model, apiKey: apiKey.trim() };
            await invoke('api_save_transcript_config', { ...config });
            setTranscriptModelConfig(config);
            window.dispatchEvent(new CustomEvent('transcript-config-updated'));
            toast.success('API transcription saved.');
            onModelSelect?.();
        } catch (error) {
            toast.error('Cannot save API transcription.', { description: String(error) });
        } finally { setIsSaving(false); }
    };

    const modelOptions = models.some(item => item.id === model) ? models : [{ id: model, name: model }, ...models];

    return (
        <div className="space-y-4 pb-6">
            <div>
                <Label htmlFor="transcription-provider">Transcription</Label>
                <Select value={provider} onValueChange={value => setProvider(value as TranscriptModelProps['provider'])} disabled={isRecording || isSaving}>
                    <SelectTrigger id="transcription-provider" className="mt-2"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="nemotron-parakeet">Local · Nemotron live + Parakeet final</SelectItem>
                        <SelectItem value="parakeet">Local · Parakeet</SelectItem>
                        <SelectItem value="localWhisper">Local · Whisper</SelectItem>
                        <SelectItem value="openrouter">API · OpenRouter</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            <LanguageSelection selectedLanguage={selectedLanguage} onLanguageChange={setSelectedLanguage} disabled={isRecording || isSaving} provider={provider} />
            {provider === 'nemotron-parakeet' && <div className="space-y-3">
                <p className="text-sm">During meeting: Nemotron live transcript.<br />After Stop: Parakeet final transcript.</p>
                <p className="text-xs text-gray-600">Microphone audio is saved as lossless recording.wav. Live and final transcripts are kept separately. Both models run on this PC.</p>
                <p className="text-sm">Nemotron: {pipelineReady.nemotron ? 'Ready' : 'Download required'} · Parakeet: {pipelineReady.parakeet ? 'Ready' : 'Download required'}</p>
                {(!pipelineReady.nemotron || !pipelineReady.parakeet) && <Button type="button" onClick={setupPipeline} disabled={downloading || isRecording}>{downloading ? 'Downloading models…' : 'Download local models'}</Button>}
                <Button type="button" onClick={savePipeline} disabled={isRecording || isSaving || downloading || !pipelineReady.nemotron || !pipelineReady.parakeet}>{isSaving ? 'Saving…' : 'Use local two-stage transcription'}</Button>
            </div>}
            {provider === 'localWhisper' && <ModelManager selectedModel={transcriptModelConfig.provider === 'localWhisper' ? transcriptModelConfig.model : undefined} onModelSelect={name => selectLocalModel('localWhisper', name)} autoSave />}
            {provider === 'parakeet' && <ParakeetModelManager selectedModel={transcriptModelConfig.provider === 'parakeet' ? transcriptModelConfig.model : undefined} onModelSelect={name => selectLocalModel('parakeet', name)} autoSave />}
            {provider === 'openrouter' && <>
                <p className="text-sm text-gray-600">Sends audio to OpenRouter. Internet and API credit required.</p>
                <div>
                    <Label htmlFor="transcription-api-model">Speech model</Label>
                    <Select value={model} onValueChange={setModel} disabled={isRecording || isSaving}>
                        <SelectTrigger id="transcription-api-model" className="mt-2"><SelectValue /></SelectTrigger>
                        <SelectContent>{modelOptions.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
                    </Select>
                </div>
                <div>
                    <Label htmlFor="transcription-api-key">API key</Label>
                    <div className="mt-2 flex gap-2">
                        <Input id="transcription-api-key" type={showApiKey ? 'text' : 'password'} value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="OpenRouter API key" autoComplete="off" spellCheck={false} disabled={isLoadingKey || isRecording || isSaving} />
                        <Button type="button" variant="outline" size="icon" aria-label={showApiKey ? 'Hide API key' : 'Show API key'} aria-pressed={showApiKey} onClick={() => setShowApiKey(previous => !previous)}>{showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
                    </div>
                </div>
                <Button type="button" onClick={saveApiSettings} disabled={isRecording || isSaving || isLoadingKey || !apiKey.trim() || !model}>{isSaving ? 'Saving…' : 'Save API settings'}</Button>
            </>}
            {isRecording && <p className="text-sm text-gray-600">Stop recording to change transcription.</p>}
        </div>
    );
}








