import { LANGUAGES } from '@/constants/languages';
import { Label } from './ui/label';

export interface Language { code: string; name: string; }

interface LanguageSelectionProps {
  selectedLanguage: string;
  onLanguageChange: (language: string) => void;
  disabled?: boolean;
  provider?: 'localWhisper' | 'parakeet' | 'nemotron-parakeet' | 'openrouter' | 'deepgram' | 'elevenLabs' | 'groq' | 'openai';
}

export function LanguageSelection({ selectedLanguage, onLanguageChange, disabled = false, provider = 'localWhisper' }: LanguageSelectionProps) {
  const isParakeet = provider === 'parakeet';
  const nemotronLanguages = ['auto', 'gsw', 'en', 'es', 'de', 'fr', 'it', 'ar', 'ja', 'ko', 'pt', 'ru', 'hi', 'zh', 'vi', 'he', 'nl', 'cs', 'da', 'pl', 'no', 'sv', 'th', 'tr', 'bg', 'el', 'et', 'fi', 'hr', 'hu', 'lt', 'lv', 'ro', 'sk', 'uk', 'mt', 'sl'];
  const options = isParakeet ? LANGUAGES.filter(language => language.code === 'auto') : LANGUAGES.filter(language =>
    provider === 'nemotron-parakeet' ? nemotronLanguages.includes(language.code) : provider !== 'openrouter' || language.code !== 'auto-translate');
  const selected = options.some(language => language.code === selectedLanguage) ? selectedLanguage : 'auto';
  return (
    <div className="space-y-2">
      <Label htmlFor="speech-language">Spoken language</Label>
      <select id="speech-language" value={selected} onChange={event => onLanguageChange(event.target.value)} disabled={disabled || isParakeet} className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm disabled:opacity-50">
        {options.map(language => <option key={language.code} value={language.code}>{language.name}</option>)}
      </select>
      {isParakeet && <p className="text-xs text-gray-600">Parakeet detects the language automatically. Use Whisper or OpenRouter to select a language.</p>}
      {selected === 'gsw' && <p className="text-xs text-gray-600">Swiss German speech → Standard German text. Whisper is recommended.</p>}
      {provider === 'nemotron-parakeet' && <p className="text-xs text-gray-600">Language selection guides Nemotron. Parakeet detects the final transcript language automatically. Swiss German accuracy varies.</p>}
    </div>
  );
}
