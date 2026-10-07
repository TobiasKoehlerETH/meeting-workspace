const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./load-typescript.cjs');

test('restores polling after reload, prevents overlapping requests, and rejects stale state after stop', async () => {
  const events = {};
  const intervals = new Map();
  const requests = [];
  const listen = name => async callback => { events[name] = callback; return () => delete events[name]; };
  const api = load('contexts/RecordingStateContext.tsx', {
    '@/services/recordingService': { recordingService: {
      getRecordingState: () => new Promise(resolve => requests.push(resolve)),
      onRecordingStarted: listen('start'), onRecordingStopped: listen('stop'),
      onRecordingPaused: listen('pause'), onRecordingResumed: listen('resume'),
    } },
  }, {
    setInterval: (callback, milliseconds) => { assert.equal(milliseconds, 1000); const id = Symbol(); intervals.set(id, callback); return id; },
    clearInterval: id => intervals.delete(id),
  });
  let current;
  let clock;
  let renders = 0;
  function Probe() { renders++; current = api.useRecordingState(); return null; }
  function Clock() { clock = api.useRecordingClock(); return null; }
  let renderer;
  await act(async () => { renderer = create(React.createElement(api.RecordingStateProvider, null, React.createElement(Probe), React.createElement(Clock))); });
  const backend = { is_recording: true, is_paused: false, is_active: true, recording_duration: 3, active_duration: 3 };
  await act(async () => requests.shift()(backend));
  assert.equal(current.status, api.RecordingStatus.RECORDING);
  assert.equal(intervals.size, 1);
  const poll = [...intervals.values()][0];
  const rendersBeforeTick = renders;
  act(() => { poll(); });
  await act(async () => requests.shift()({ ...backend, active_duration: 4, recording_duration: 4 }));
  assert.equal(clock.activeDuration, 4);
  assert.equal(renders, rendersBeforeTick, 'Timer updates must not rerender recording controls and page consumers');
  act(() => current.setTranscriptProgress({ percentage: 30, message: 'Transcribing' }));
  assert.equal(renders, rendersBeforeTick, 'Progress updates must not rerender unrelated lifecycle consumers');
  act(() => { poll(); poll(); });
  assert.equal(requests.length, 1);
  act(() => events.stop());
  assert.equal(intervals.size, 0);
  await act(async () => requests.shift()(backend));
  assert.equal(current.isRecording, false);
  assert.equal(clock.activeDuration, null);
  await act(async () => renderer.unmount());
  assert.deepEqual(events, {});
});
