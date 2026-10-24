import { LANGUAGES } from '@/constants/languages';
import { Label } from './ui/label';

export interface Language { code: string; name: string; }

interface LanguageSelectionProps {
  selectedLanguage: string;
  onLanguageChange: (language: string) => void;
  disabled?: boolean;
  provider?: 'localWhisper' | 'parakeet';
}

export function LanguageSelection({ selectedLanguage, onLanguageChange, disabled = false, provider = 'localWhisper' }: LanguageSelectionProps) {
  const selected = LANGUAGES.some(language => language.code === selectedLanguage) ? selectedLanguage : 'auto';
  return (
    <div className="space-y-2">
      <Label htmlFor="speech-language">Language</Label>
      <select id="speech-language" title={selected === 'gsw' ? 'Uses the Swiss German Whisper model once downloaded' : provider === 'parakeet' ? 'Parakeet detects English or German itself' : undefined} value={selected} onChange={event => onLanguageChange(event.target.value)} disabled={disabled} className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm disabled:opacity-50">
        {LANGUAGES.map(language => <option key={language.code} value={language.code}>{language.name}</option>)}
      </select>
    </div>
  );
}
