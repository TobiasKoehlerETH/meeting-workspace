const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./load-typescript.cjs');

test('speaker settings validate counts and retain the saved switch when saving fails', async () => {
  const calls = [];
  const { SpeakerSettings } = load('components/SpeakerSettings.tsx', {
    '@tauri-apps/api/core': { invoke: async (command, args) => {
      calls.push([command, args]);
      if (command === 'get_speaker_settings') return { enabled: true, speaker_count: 0 };
      if (args.settings.enabled === false) throw new Error('Disk full');
    } },
    './ui/switch': { Switch: props => React.createElement('switch', props) },
    './ui/input': { Input: props => React.createElement('input', props) },
    './ui/label': { Label: props => React.createElement('label', props) },
  });
  let renderer;
  await act(async () => { renderer = create(React.createElement(SpeakerSettings)); });
  const input = () => renderer.root.findByType('input');
  await act(async () => input().props.onChange({ target: { value: '21' } }));
  await act(async () => input().props.onBlur());
  assert.equal(calls.length, 1);
  await act(async () => input().props.onChange({ target: { value: '4' } }));
  await act(async () => input().props.onBlur());
  assert.deepEqual(calls.at(-1), ['set_speaker_settings', { settings: { enabled: true, speaker_count: 4 } }]);
  await act(async () => renderer.root.findByType('switch').props.onCheckedChange(false));
  assert.equal(renderer.root.findByType('switch').props.checked, true);
  assert.match(renderer.root.findByProps({ role: 'alert' }).children.join(''), /Could not save/);
  await act(async () => renderer.unmount());
});

test('speaker renaming sends the meeting identity and refreshes transcripts', async () => {
  const calls = [];
  let refreshes = 0;
  let rejectRename = false;
  const { SpeakerNames } = load('components/MeetingDetails/SpeakerNames.tsx', {
    '@tauri-apps/api/core': { invoke: async (command, args) => {
      calls.push([command, args]);
      if (command === 'list_meeting_speakers') return ['Speaker 1', 'Speaker 2'];
      if (rejectRename) throw new Error('That name already belongs to another speaker.');
    } },
    '@/components/ui/input': { Input: props => React.createElement('input', props) },
    '@/components/ui/button': { Button: props => React.createElement('button', props) },
  });
  let renderer;
  await act(async () => { renderer = create(React.createElement(SpeakerNames, {
    meetingId: 'meeting-1', revision: 'segment-1', onChanged: async () => { refreshes++; },
  })); });
  await act(async () => renderer.root.findByType('input').props.onChange({ target: { value: 'Maya' } }));
  await act(async () => renderer.root.findByType('button').props.onClick());
  assert.deepEqual(calls.at(-1), ['rename_meeting_speaker', { meetingId: 'meeting-1', speaker: 'Speaker 1', name: 'Maya' }]);
  assert.equal(refreshes, 1);
  assert.equal(renderer.root.findByType('select').props.value, 'Maya');
  rejectRename = true;
  await act(async () => renderer.root.findByType('input').props.onChange({ target: { value: 'Speaker 2' } }));
  await act(async () => renderer.root.findByType('button').props.onClick());
  assert.equal(refreshes, 1);
  assert.equal(renderer.root.findByType('select').props.value, 'Maya');
  assert.match(renderer.root.findByProps({ role: 'alert' }).children.join(''), /already belongs/);
  await act(async () => renderer.unmount());
});
