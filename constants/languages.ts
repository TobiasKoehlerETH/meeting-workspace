// Spoken languages this app is tuned for. Swiss German uses Whisper's German token
// and the Swiss German model; all three are written as English or Standard German.
export const LANGUAGES = [
  { code: 'auto', name: 'Detect automatically' },
  { code: 'en', name: 'English' },
  { code: 'de', name: 'German' },
  { code: 'gsw', name: 'Swiss German → Standard German' },
];

export const isSupportedLanguage = (code: string) => LANGUAGES.some(language => language.code === code);
