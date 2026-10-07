const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./load-typescript.cjs');

test('launch preferences load independently and a failed save retains the previous value', async () => {
  const calls = [];
  const { LaunchSettings } = load('components/LaunchSettings.tsx', {
    '@tauri-apps/api/core': { invoke: async (command, args) => {
      calls.push([command, args]);
      if (command === 'get_start_minimized') return true;
      if (command === 'get_stealth_mode') return false;
      if (command === 'set_start_minimized') throw new Error('Disk is full');
    } },
    './ui/switch': { Switch: props => React.createElement('switch', props) },
  });
  let renderer;
  await act(async () => { renderer = create(React.createElement(LaunchSettings)); });
  const switches = () => renderer.root.findAllByType('switch');
  assert.deepEqual(switches().map(item => item.props.checked), [true, false]);
  await act(async () => switches()[1].props.onCheckedChange(true));
  assert.deepEqual(switches().map(item => item.props.checked), [true, true]);
  assert.deepEqual(calls.at(-1), ['set_stealth_mode', { enabled: true }]);
  await act(async () => switches()[0].props.onCheckedChange(false));
  assert.equal(switches()[0].props.checked, true);
  assert.match(renderer.root.findByProps({ role: 'alert' }).children.join(''), /Could not save/);
  await act(async () => renderer.unmount());
});

test('discreet sessions suppress the recording banner before loading its preferences', async () => {
  let displayed = 0;
  let preferencesLoaded = 0;
  let stealth = true;
  const { showRecordingNotification } = load('lib/recordingNotification.tsx', {
    '@tauri-apps/api/core': { invoke: async () => stealth },
    '@tauri-apps/plugin-store': { Store: { load: async () => {
      preferencesLoaded++;
      return { get: async () => true };
    } } },
    sonner: { toast: { info: () => displayed++ } },
  });
  await showRecordingNotification();
  assert.equal(displayed, 0);
  assert.equal(preferencesLoaded, 0);
  stealth = false;
  await showRecordingNotification();
  assert.equal(displayed, 1);
});
