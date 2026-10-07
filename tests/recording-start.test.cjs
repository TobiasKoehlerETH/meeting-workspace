const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./load-typescript.cjs');

test('tray start waits for saved audio devices and starts capture only once', async () => {
  const calls = [];
  const storage = new Map([['autoStartRecording', 'true']]);
  const listeners = new Map();
  const config = { devicesLoaded: false, selectedDevices: { micDevice: null, systemDevice: null } };
  const noOp = () => {};
  const transcript = { setMeetingTitle: noOp };
  const sidebar = { setIsMeetingActive: noOp };
  const recordingState = { setStatus: noOp, status: 'idle' };
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const { useRecordingStart } = load('hooks/useRecordingStart.ts', {
    '@/contexts/TranscriptContext': { useTranscripts: () => transcript },
    '@/components/Sidebar/SidebarProvider': { useSidebar: () => sidebar },
    '@/contexts/ConfigContext': { useConfig: () => config },
    '@/contexts/RecordingStateContext': {
      useRecordingState: () => recordingState,
      RecordingStatus: { STARTING: 'starting', ERROR: 'error', STOPPING: 'stopping', SAVING: 'saving', PROCESSING_TRANSCRIPTS: 'processing' },
    },
    '@/services/recordingService': { recordingService: {
      startRecordingWithDevices: (...args) => { calls.push(args); return pending; },
    } },
    '@/lib/recordingNotification': { showRecordingNotification: async () => {} },
    sonner: { toast: { error: noOp } },
  }, {
    sessionStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
    window: {
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: name => listeners.delete(name),
    },
  });
  function Probe() { useRecordingStart(false, noOp); return null; }
  let renderer;
  await act(async () => { renderer = create(React.createElement(Probe)); });
  assert.equal(calls.length, 0);
  assert.equal(storage.get('autoStartRecording'), 'true');

  config.selectedDevices = { micDevice: 'Saved microphone', systemDevice: 'Saved speakers' };
  config.devicesLoaded = true;
  await act(async () => renderer.update(React.createElement(Probe)));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ['Saved microphone', 'Saved speakers']);
  assert.equal(storage.has('autoStartRecording'), false);
  await act(async () => listeners.get('start-recording-from-sidebar')());
  assert.equal(calls.length, 1);
  await act(async () => { finish(); await pending; });
  await act(async () => renderer.unmount());
  assert.equal(listeners.size, 0);
});
