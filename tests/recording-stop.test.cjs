const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./load-typescript.cjs');

function fixture({ transcribe = async () => {}, save = async () => {}, register } = {}) {
  const calls = [];
  const timers = [];
  const storage = new Map([
    ['last_recording_folder_path', 'C:/recordings/test'],
    ['last_recording_meeting_name', 'Planning'],
  ]);
  let listener;
  let cleaned = 0;
  let current;
  let renderer;
  const noOp = () => {};
  const router = { push: path => calls.push(['navigate', path]) };
  const recordingState = { status: 'idle', setStatus: noOp, setTranscriptProgress: noOp };
  const sidebar = {
    refetchMeetings: async () => calls.push(['refresh']),
    setCurrentMeeting: noOp,
  };
  const transcript = {
    meetingTitle: 'Fallback title',
    markMeetingAsSaved: async () => calls.push(['recovery-saved']),
  };
  const { useRecordingStop } = load('hooks/useRecordingStop.ts', {
    '@/lib/finalize-transcript': { finalizeTranscript: async (meetingId, meetingFolderPath) => {
      calls.push(['finalize_local_transcript', { meetingId, meetingFolderPath }]);
      await transcribe();
    } },
    'next/navigation': { useRouter: () => router },
    '@tauri-apps/api/event': { listen: register || (async (_name, callback) => {
      listener = callback;
      return () => cleaned++;
    }) },
    '@tauri-apps/api/core': { invoke: async (command, args) => {
      calls.push([command, args]);
      await transcribe();
    } },
    sonner: { toast: {
      warning: message => calls.push(['warning', message]),
      success: noOp, error: noOp,
    } },
    '@/contexts/TranscriptContext': { useTranscripts: () => transcript },
    '@/components/Sidebar/SidebarProvider': { useSidebar: () => sidebar },
    '@/contexts/RecordingStateContext': {
      useRecordingState: () => recordingState,
      RecordingStatus: { STOPPING: 'stopping', SAVING: 'saving', PROCESSING_TRANSCRIPTS: 'processing', COMPLETED: 'completed', IDLE: 'idle', ERROR: 'error' },
    },
    '@/services/storageService': { storageService: {
      saveMeeting: async (...args) => { calls.push(['save', ...args]); await save(); return { meeting_id: 'meeting-1' }; },
      getMeeting: async () => ({ title: 'Planning' }),
    } },
    '@/lib/summary-language-preferences': { applyPinnedSummaryLanguageToMeeting: async () => {} },
  }, {
    sessionStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
    setTimeout: callback => timers.push(callback),
  });
  function Probe() { current = useRecordingStop(); return null; }
  return {
    calls, storage, get current() { return current; }, get cleaned() { return cleaned; },
    get listener() { return listener; },
    async mount() { await act(async () => { renderer = create(React.createElement(Probe)); }); },
    async unmount() { await act(async () => renderer.unmount()); },
    finishNavigation() { timers.forEach(callback => callback()); },
  };
}

test('Stop saves audio only, prevents duplicate meetings, and opens the saved recording immediately', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const f = fixture({ save: () => pending });
  await f.mount();
  const stop = f.current.handleRecordingStop(true);
  await act(async () => {});
  assert.deepEqual(f.calls[0], ['save', 'Planning', [], 'C:/recordings/test']);
  await f.current.handleRecordingStop(true);
  assert.equal(f.calls.filter(call => call[0] === 'save').length, 1);
  finish();
  await act(async () => stop);
  assert.deepEqual(f.calls.at(-1), ['navigate', '/meeting-details?id=meeting-1']);
  assert.equal(f.calls.filter(call => call[0] === 'finalize_local_transcript').length, 0);
  assert.equal(f.storage.size, 0);
  await f.unmount();
  assert.equal(f.cleaned, 1);
});

test('recording can be saved without a speech model and never triggers inference', async () => {
  const f = fixture({ transcribe: async () => { throw new Error('Model missing'); } });
  await f.mount();
  await act(async () => f.current.handleRecordingStop(true));
  f.finishNavigation();
  assert.equal(f.calls.filter(call => call[0] === 'save').length, 1);
  assert.equal(f.calls.filter(call => call[0] === 'finalize_local_transcript').length, 0);
  assert.equal(f.calls.filter(call => call[0] === 'warning').length, 0);
  assert.deepEqual(f.calls.at(-1), ['navigate', '/meeting-details?id=meeting-1']);
  await f.unmount();
});

test('stop listeners registered after unmount are immediately removed', async () => {
  let resolve;
  let cleaned = 0;
  const pending = new Promise(done => { resolve = done; });
  const f = fixture({ register: () => pending });
  await f.mount();
  await f.unmount();
  await act(async () => resolve(() => cleaned++));
  assert.equal(cleaned, 1);
});
