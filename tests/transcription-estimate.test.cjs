const assert = require('node:assert/strict');
const { test } = require('node:test');
const load = require('./load-typescript.cjs');

const models = load('lib/speech-models.ts', { '@tauri-apps/api/core': { invoke: async () => [] } });
const estimates = () => load('lib/transcription-estimate.ts', {
  '@tauri-apps/api/core': { invoke: async () => ({}) },
  '@/lib/speech-models': models,
}, { localStorage: new Map() });

test('estimates scale with audio length, model speed, speaker detection and GPU', () => {
  const { estimateTranscription } = estimates();
  const cpu = { cpu_cores: 8, gpu_backend: 'Cpu' };
  const turbo = estimateTranscription('large-v3-turbo-q5_0', 3600, false, cpu, []);
  assert.equal(turbo.measured, false);
  assert.ok(estimateTranscription('large-v3-turbo-q5_0', 1800, false, cpu, []).seconds < turbo.seconds);
  assert.ok(estimateTranscription('large-v3', 3600, false, cpu, []).seconds > turbo.seconds);
  assert.ok(estimateTranscription('parakeet-tdt-0.6b-v3-int8', 3600, false, cpu, []).seconds < turbo.seconds);
  assert.ok(estimateTranscription('large-v3-turbo-q5_0', 3600, true, cpu, []).seconds > turbo.seconds);
  assert.ok(estimateTranscription('large-v3-turbo-q5_0', 3600, false, { cpu_cores: 8, gpu_backend: 'Cuda' }, []).seconds < turbo.seconds);
});

test('measured runs on this device calibrate the same model and then all models', () => {
  const { estimateTranscription } = estimates();
  const hardware = { cpu_cores: 8, gpu_backend: 'Cpu' };
  const base = estimateTranscription('large-v3-turbo-q5_0', 600, false, hardware, []).seconds;
  const slow = [{ model: 'large-v3-turbo-q5_0', audio: 600, elapsed: base * 2, speakers: false }];
  const calibrated = estimateTranscription('large-v3-turbo-q5_0', 600, false, hardware, slow);
  assert.equal(calibrated.measured, true);
  assert.ok(Math.abs(calibrated.seconds - base * 2) < 0.01);
  const other = estimateTranscription('small', 600, false, hardware, slow);
  assert.equal(other.measured, false);
  assert.ok(Math.abs(other.seconds / estimateTranscription('small', 600, false, hardware, []).seconds - 2) < 0.01);
  const tooShort = [{ model: 'small', audio: 5, elapsed: 500, speakers: false }];
  assert.equal(estimateTranscription('small', 600, false, hardware, tooShort).measured, false);
});

test('durations format for people', () => {
  const { formatEstimate } = estimates();
  assert.equal(formatEstimate({ seconds: 20, measured: false }), 'under 1 min');
  assert.equal(formatEstimate({ seconds: 260, measured: false }), '~4 min');
  assert.equal(formatEstimate({ seconds: 4500, measured: true }), '1 h 15 min');
  const { formatClock } = load('lib/utils.ts');
  assert.equal(formatClock(75), '01:15');
  assert.equal(formatClock(3725), '1:02:05');
  assert.equal(formatClock(null), '00:00');
});
