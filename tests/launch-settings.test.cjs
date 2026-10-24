const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./load-typescript.cjs');

test('start minimized loads and saves, and a failed save retains the previous value', async () => {
  const calls = [];
  let saveFails = false;
  const { LaunchSettings } = load('components/LaunchSettings.tsx', {
    '@tauri-apps/api/core': { invoke: async (command, args) => {
      calls.push([command, args]);
      if (command === 'get_start_minimized') return true;
      if (command === 'set_start_minimized' && saveFails) throw new Error('Disk is full');
    } },
    './ui/switch': { Switch: props => React.createElement('switch', props) },
  });
  let renderer;
  await act(async () => { renderer = create(React.createElement(LaunchSettings)); });
  const switches = () => renderer.root.findAllByType('switch');
  assert.equal(switches().length, 1);
  assert.equal(switches()[0].props['aria-label'], 'Start minimized');
  assert.equal(switches()[0].props.checked, true);
  await act(async () => switches()[0].props.onCheckedChange(false));
  assert.equal(switches()[0].props.checked, false);
  assert.deepEqual(calls.at(-1), ['set_start_minimized', { enabled: false }]);
  saveFails = true;
  await act(async () => switches()[0].props.onCheckedChange(true));
  assert.equal(switches()[0].props.checked, false);
  assert.equal(switches()[0].props.disabled, false);
  assert.match(renderer.root.findByProps({ role: 'alert' }).children.join(''), /Could not save/);
  await act(async () => renderer.unmount());
});

test('the recording banner follows its saved preference and appears by default', async () => {
  let displayed = 0;
  let preferencesLoaded = 0;
  let showNotification;
  const { showRecordingNotification } = load('lib/recordingNotification.tsx', {
    '@tauri-apps/plugin-store': { Store: { load: async () => {
      preferencesLoaded++;
      return { get: async () => showNotification };
    } } },
    sonner: { toast: { info: () => displayed++ } },
  });
  await showRecordingNotification();
  assert.equal(displayed, 1);
  assert.equal(preferencesLoaded, 1);
  showNotification = false;
  await showRecordingNotification();
  assert.equal(displayed, 1);
  assert.equal(preferencesLoaded, 2);
  showNotification = true;
  await showRecordingNotification();
  assert.equal(displayed, 2);
  assert.equal(preferencesLoaded, 3);
});
