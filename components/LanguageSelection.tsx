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
  const isParakeet = provider === 'parakeet';
  const options = isParakeet ? LANGUAGES.filter(language => language.code === 'auto') : LANGUAGES;
  const selected = options.some(language => language.code === selectedLanguage) ? selectedLanguage : 'auto';
  return (
    <div className="space-y-2">
      <Label htmlFor="speech-language">Spoken language</Label>
      <select id="speech-language" value={selected} onChange={event => onLanguageChange(event.target.value)} disabled={disabled || isParakeet} className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm disabled:opacity-50">
        {options.map(language => <option key={language.code} value={language.code}>{language.name}</option>)}
      </select>
      {isParakeet && <p className="text-xs text-gray-600">Detected automatically by Parakeet.</p>}
      {selected === 'gsw' && <p className="text-xs text-gray-600">Swiss German &rarr; Standard German text.</p>}
    </div>
  );
}
