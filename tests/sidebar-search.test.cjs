const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./load-typescript.cjs');

test('search coalesces typing, ignores stale replies, and cancels on clear and unmount', async () => {
  const timers = new Map();
  const requests = [];
  const api = load('components/Sidebar/SidebarProvider.tsx', {
    'next/navigation': { usePathname: () => '/' },
    '@tauri-apps/api/core': { invoke: (command, args) => {
      if (command === 'api_get_meetings') return Promise.resolve([]);
      return new Promise(resolve => requests.push({ query: args.query, resolve }));
    } },
  }, {
    setTimeout: (callback, delay) => { assert.equal(delay, 250); const id = Symbol(); timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
  });
  let current;
  function Probe() { current = api.useSidebar(); return null; }
  let renderer;
  await act(async () => { renderer = create(React.createElement(api.SidebarProvider, null, React.createElement(Probe))); });
  const flush = () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); };
  act(() => { current.searchTranscripts('p'); current.searchTranscripts('pl'); current.searchTranscripts('plan'); });
  assert.equal(timers.size, 1);
  assert.equal(requests.length, 0);
  act(flush);
  assert.equal(requests[0].query, 'plan');
  act(() => current.searchTranscripts('review'));
  await act(async () => requests[0].resolve([{ id: 'old' }]));
  assert.deepEqual(current.searchResults, []);
  assert.equal(current.isSearching, true, 'Old completion must not hide the new search indicator');
  act(flush);
  await act(async () => requests[1].resolve([{ id: 'new' }]));
  assert.deepEqual(current.searchResults, [{ id: 'new' }]);
  assert.equal(current.isSearching, false);
  act(() => { current.searchTranscripts('another'); flush(); current.searchTranscripts(''); });
  await act(async () => requests[2].resolve([{ id: 'cleared' }]));
  assert.deepEqual(current.searchResults, []);
  assert.equal(current.isSearching, false);
  act(() => current.searchTranscripts('cancel'));
  assert.equal(timers.size, 1);
  act(() => renderer.unmount());
  assert.equal(timers.size, 0);
});
