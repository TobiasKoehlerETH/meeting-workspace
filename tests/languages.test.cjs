const assert = require('node:assert/strict');
const { test } = require('node:test');
const load = require('./load-typescript.cjs');

test('spoken languages are limited to English, German and Swiss German', () => {
  const { LANGUAGES, isSupportedLanguage } = load('constants/languages.ts');
  assert.deepEqual(LANGUAGES.map(language => language.code), ['auto', 'en', 'de', 'gsw']);
  assert.equal(isSupportedLanguage('gsw'), true);
  assert.equal(isSupportedLanguage('fr'), false);
});

test('summaries are written in English or German, Swiss German as German', () => {
  const { LANGUAGE_OPTIONS, normaliseLanguageCode } = load('lib/summary-languages.ts');
  assert.deepEqual(LANGUAGE_OPTIONS.map(language => language.code), ['en', 'de']);
  assert.equal(normaliseLanguageCode('de-CH'), 'de');
  assert.equal(normaliseLanguageCode('gsw'), 'de');
  assert.equal(normaliseLanguageCode('en_GB'), 'en');
  assert.equal(normaliseLanguageCode('fr'), null);
});

test('the Swiss German model is listed with the recommended models', () => {
  const { MODEL_SPECS, SWISS_GERMAN_MODEL } = load('lib/speech-models.ts', { '@tauri-apps/api/core': { invoke: async () => [] } });
  const spec = MODEL_SPECS[SWISS_GERMAN_MODEL];
  assert.equal(spec.provider, 'localWhisper');
  assert.equal(spec.advanced, undefined);
  assert.equal(Object.keys(MODEL_SPECS).indexOf(SWISS_GERMAN_MODEL), 1);
});
