const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./load-typescript.cjs');

test('finalization subscribes before invoking, filters meetings, and cleans up on success', async () => {
  let callback;
  let finish;
  let cleaned = 0;
  const updates = [];
  const pending = new Promise(resolve => { finish = resolve; });
  const { finalizeTranscript } = load('lib/finalize-transcript.ts', {
    '@tauri-apps/api/event': { listen: async (name, handler) => {
      assert.equal(name, 'retranscription-progress'); callback = handler; return () => cleaned++;
    } },
    '@tauri-apps/api/core': { invoke: async (command, args) => {
      assert.ok(callback); assert.equal(command, 'finalize_local_transcript');
      assert.equal(args.meetingId, 'one'); await pending;
    } },
  });
  const job = finalizeTranscript('one', 'folder', update => updates.push(update));
  await Promise.resolve();
  const emit = (meeting_id, progress_percentage) => callback({ payload: { meeting_id, progress_percentage, message: 'Transcribing segment' } });
  emit('other', 90); emit('one', NaN);
  assert.equal(updates.length, 1);
  emit('one', 65); emit('one', 20); emit('one', 100);
  assert.deepEqual(updates.map(u => u.percentage), [0, 65, 65, 99]);
  finish(); await job;
  assert.equal(updates.at(-1).percentage, 100); assert.equal(cleaned, 1);
  const count = updates.length; emit('one', 80); assert.equal(updates.length, count);
});

test('failure clears progress and listener failure does not block transcription', async () => {
  for (const registrationFails of [false, true]) {
    let cleaned = 0;
    let invoked = false;
    const updates = [];
    const { finalizeTranscript } = load('lib/finalize-transcript.ts', {
      '@tauri-apps/api/event': { listen: async () => {
        if (registrationFails) throw new Error('No events');
        return () => cleaned++;
      } },
      '@tauri-apps/api/core': { invoke: async () => { invoked = true; throw new Error('Missing model'); } },
    }, { console: { error() {} } });
    await assert.rejects(finalizeTranscript('one', 'folder', update => updates.push(update)), /Missing model/);
    assert.ok(invoked); assert.equal(updates.at(-1), null);
    assert.equal(cleaned, registrationFails ? 0 : 1);
  }
});

test('global bar shows determinate progress, saving fallback, and hides during capture or error', async () => {
  let state = { status: 'processing', isRecording: false };
  let progress = { percentage: 42, message: 'Transcribing segment 2 of 5' };
  const { TranscriptProgressBar } = load('components/TranscriptProgressBar.tsx', {
    '@/contexts/RecordingStateContext': {
      RecordingStatus: { COMPLETED: 'completed', PROCESSING_TRANSCRIPTS: 'processing', SAVING: 'saving', STOPPING: 'stopping' },
      useRecordingState: () => state, useTranscriptProgress: () => progress,
    },
    '@/components/Sidebar/SidebarProvider': { useSidebar: () => ({ isCollapsed: true }) },
  });
  let renderer;
  const render = async () => act(async () => {
    if (renderer) renderer.update(React.createElement(TranscriptProgressBar));
    else renderer = create(React.createElement(TranscriptProgressBar));
  });
  await render();
  assert.equal(renderer.root.findByProps({ role: 'progressbar' }).props['aria-valuenow'], 42);
  assert.match(renderer.root.findByProps({ role: 'status' }).children.join(''), /segment 2/);
  progress = null; state = { status: 'saving', isRecording: false }; await render();
  assert.equal(renderer.root.findByProps({ role: 'progressbar' }).props['aria-valuenow'], undefined);
  state = { status: 'processing', isRecording: true }; await render(); assert.equal(renderer.toJSON(), null);
  state = { status: 'error', isRecording: false }; await render(); assert.equal(renderer.toJSON(), null);
  await act(async () => renderer.unmount());
});
