import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { BuiltInModelManager } from './BuiltInModelManager';
import { Button } from './ui/button';
import { toast } from 'sonner';

export interface ModelConfig {
  provider: 'ollama' | 'groq' | 'claude' | 'openai' | 'openrouter' | 'builtin-ai' | 'custom-openai';
  model: string;
  whisperModel: string;
  apiKey?: string | null;
  ollamaEndpoint?: string | null;
  // Custom OpenAI fields
  customOpenAIEndpoint?: string | null;
  customOpenAIModel?: string | null;
  customOpenAIApiKey?: string | null;
  maxTokens?: number | null;
  temperature?: number | null;
  topP?: number | null;
}

interface ModelSettingsModalProps {
  modelConfig: ModelConfig;
  setModelConfig: (config: ModelConfig | ((prev: ModelConfig) => ModelConfig)) => void;
  onSave: (config: ModelConfig) => void;
  skipInitialFetch?: boolean; // Optional: skip fetching config from backend if parent manages it
  layout?: 'inline' | 'dialog';
}

export function ModelSettingsModal({ modelConfig, setModelConfig, onSave, skipInitialFetch, layout = 'inline' }: ModelSettingsModalProps) {
  useEffect(() => {
    if (skipInitialFetch) return;
    let closed = false;
    invoke<ModelConfig | null>('api_get_model_config')
      .then(config => { if (!closed && config) setModelConfig(config); })
      .catch(() => { if (!closed) toast.error('Cannot load the summary model settings.'); });
    return () => { closed = true; };
  }, [skipInitialFetch, setModelConfig]);
  return <div className="space-y-4">
    <p className="text-sm text-gray-600">Summaries run locally. Qwen 3.5 4B is the quality-first default. Download a model once, then use it offline.</p>
    <BuiltInModelManager selectedModel={modelConfig.model} layout={layout} onModelSelect={model => setModelConfig({ ...modelConfig, provider: 'builtin-ai', model, apiKey: null })} />
    <Button onClick={() => onSave({ ...modelConfig, provider: 'builtin-ai', apiKey: null })}>Save local model</Button>
  </div>;
}
