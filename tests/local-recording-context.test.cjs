const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./load-typescript.cjs');

function fixture(startListener) {
  const events = {};
  const storage = new Map();
  const saved = [];
  const subscribe = name => async callback => {
    events[name] = callback;
    return () => delete events[name];
  };
  const api = load('contexts/TranscriptContext.tsx', {
    '@/services/recordingService': { recordingService: {
      onRecordingStarted: startListener || subscribe('started'),
      onRecordingStopped: subscribe('stopped'),
      getRecordingMeetingName: async () => 'Test meeting',
    } },
    '@/services/indexedDBService': { indexedDBService: {
      init: async () => {}, saveMeetingMetadata: async metadata => saved.push(metadata),
      getMeetingMetadata: async () => saved[0], markMeetingSaved: async () => {},
    } },
    '@tauri-apps/api/core': { invoke: async () => 'C:/recordings/test' },
  }, {
    sessionStorage: {
      setItem: (key, value) => storage.set(key, value),
      getItem: key => storage.get(key) ?? null,
      removeItem: key => storage.delete(key),
    },
  });
  let current;
  let renderer;
  function Probe() { current = api.useTranscripts(); return null; }
  return {
    events, saved, get current() { return current; },
    async mount() { await act(async () => { renderer = create(React.createElement(api.TranscriptProvider, null, React.createElement(Probe))); }); },
    async unmount() { await act(async () => renderer.unmount()); },
  };
}

test('records recovery metadata without subscribing to live transcript updates', async () => {
  const f = fixture();
  await f.mount();
  assert.deepEqual(Object.keys(f.events).sort(), ['started', 'stopped']);
  const stopListener = f.events.stopped;
  await act(async () => f.events.started());
  assert.equal(f.current.meetingTitle, 'Test meeting');
  assert.equal(f.saved[0].transcriptCount, 0);
  assert.equal(f.events.stopped, stopListener);
  await act(async () => f.events.stopped({ folder_path: 'C:/recordings/final' }));
  assert.equal(f.saved.at(-1).folderPath, 'C:/recordings/final');
  await act(async () => f.current.markMeetingAsSaved());
  assert.equal(f.current.currentMeetingId, null);
  await f.unmount();
  assert.deepEqual(f.events, {});
});

test('cleans up a recording listener that resolves after unmount', async () => {
  let resolve;
  let cleaned = 0;
  const registration = new Promise(done => { resolve = done; });
  const f = fixture(() => registration);
  await f.mount();
  await f.unmount();
  await act(async () => resolve(() => cleaned++));
  assert.equal(cleaned, 1);
  assert.deepEqual(f.events, {});
});
