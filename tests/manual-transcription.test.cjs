const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./load-typescript.cjs');

test('a saved meeting starts inference only after Transcribe is clicked and rejects double clicks', async () => {
  const calls = [];
  const state = { status: 'idle', isRecording: false, isProcessing: false, isStopping: false, isSaving: false,
    setStatus: status => calls.push(['status', status]), setTranscriptProgress() {} };
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const { TranscriptButtonGroup } = load('components/MeetingDetails/TranscriptButtonGroup.tsx', {
    '@/components/ui/button': { Button: props => React.createElement('button', props) },
    '@/contexts/RecordingStateContext': { useRecordingState: () => state,
      RecordingStatus: { STARTING: 'starting', PROCESSING_TRANSCRIPTS: 'processing', COMPLETED: 'completed', ERROR: 'error' } },
    '@/lib/finalize-transcript': { finalizeTranscript: async (id, folder) => { calls.push(['transcribe', id, folder]); await pending; } },
    sonner: { toast: { error: message => calls.push(['error', message]) } },
  }, { window: { dispatchEvent: event => calls.push(['event', event.type]) }, CustomEvent: class { constructor(type) { this.type = type; } } });
  let renderer;
  await act(async () => { renderer = create(React.createElement(TranscriptButtonGroup, {
    transcriptCount: 0, meetingId: 'saved', meetingFolderPath: 'C:/saved', onCopyTranscript() {}, onOpenMeetingFolder() {},
    onRefetchTranscripts: async () => calls.push(['refresh']),
  })); });
  assert.deepEqual(calls, []);
  const transcribeButton = renderer.root.findAllByType('button')[0];
  await act(async () => { transcribeButton.props.onClick(); transcribeButton.props.onClick(); });
  assert.equal(calls.filter(call => call[0] === 'transcribe').length, 1);
  assert.deepEqual(calls.find(call => call[0] === 'transcribe'), ['transcribe', 'saved', 'C:/saved']);
  await act(async () => { finish(); await pending; });
  assert.ok(calls.some(call => call[0] === 'refresh'));
  assert.ok(calls.some(call => call[1] === 'completed'));
  await act(async () => renderer.unmount());
});

test('recording player resolves audio only on demand and streams instead of reading it into JS', async () => {
  const calls = [];
  const { RecordingPlayer } = load('components/MeetingDetails/RecordingPlayer.tsx', {
    '@tauri-apps/api/core': { invoke: async (...args) => { calls.push(args); return 'C:/saved/recording.wav'; }, convertFileSrc: path => `asset://${path}` },
    '@/components/ui/button': { Button: props => React.createElement('button', props) },
  });
  let renderer;
  await act(async () => { renderer = create(React.createElement(RecordingPlayer, { meetingId: 'saved' })); });
  assert.equal(calls.length, 0);
  await act(async () => renderer.root.findByType('button').props.onClick());
  assert.deepEqual(calls, [['get_meeting_audio_path', { meetingId: 'saved' }]]);
  assert.equal(renderer.root.findByType('audio').props.preload, 'none');
  await act(async () => renderer.unmount());
});

test('concurrent device checks share a request and a later refresh queries hardware again', async () => {
  let resolve;
  let count = 0;
  const { getAudioDevices } = load('services/audioDeviceService.ts', {
    '@tauri-apps/api/core': { invoke: () => { count++; return new Promise(done => { resolve = done; }); } },
  });
  const first = getAudioDevices(); const second = getAudioDevices();
  assert.equal(first, second); assert.equal(count, 1);
  resolve([]); await first;
  const third = getAudioDevices(); assert.equal(count, 2); resolve([]); await third;
});
