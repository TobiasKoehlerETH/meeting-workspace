const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { act, create } = require('react-test-renderer');
const load = require('./load-typescript.cjs');

const geometry = load('lib/recorder-window.ts');
const { miniRecorderBounds, visibleWindowBounds, parseWindowPosition } = geometry;

test('invalid saved positions fall back to a visible default', () => {
  const display = monitor();
  for (const saved of [null, '', '{', 'null', 'false', '[]', '{}', '{"x":"20","y":30}', '{"x":20}', '{"x":1e999,"y":30}']) {
    const position = parseWindowPosition(saved);
    assert.equal(position, null, String(saved));
    const bounds = miniRecorderBounds(position, [display]);
    assertInside(bounds, display);
    assert.ok(bounds.position.y >= 0);
  }
  assert.deepEqual(parseWindowPosition('{"x":-1500.6,"y":100.2}'), { x: -1501, y: 100 });
});

test('a disconnected display position returns to a connected work area', () => {
  const display = monitor();
  const bounds = miniRecorderBounds({ x: 4000, y: -1200 }, [display]);
  assertInside(bounds, display);
  assert.deepEqual(bounds, miniRecorderBounds(null, [display]));
});

test('a partly offscreen mini recorder fits at every work area edge', () => {
  const display = monitor({ x: -1600, y: -900, width: 1600, height: 900,
    workArea: { position: { x: -1560, y: -870 }, size: { width: 1560, height: 830 } } });
  for (const position of [
    { x: -1600, y: -800 },
    { x: -100, y: -800 },
    { x: -1300, y: -890 },
    { x: -1300, y: -60 },
  ]) {
    assertInside(miniRecorderBounds(position, [display]), display);
  }
});

test('valid placement on a secondary display is preserved', () => {
  const secondary = monitor({ x: -1920, y: 0 });
  const saved = { x: -1600, y: 120 };
  assert.deepEqual(miniRecorderBounds(saved, [monitor(), secondary]).position, saved);
});

test('mini recorder size and placement use physical pixels on scaled displays', () => {
  for (const scaleFactor of [1.25, 1.5, 2]) {
    const display = monitor({ x: 1920, y: -200, scaleFactor });
    const bounds = miniRecorderBounds(null, [display]);
    assert.deepEqual(bounds.size, { width: Math.round(232 * scaleFactor), height: Math.round(48 * scaleFactor) });
    assertInside(bounds, display);
    const rightEdge = display.workArea.position.x + display.workArea.size.width;
    assert.equal(rightEdge - bounds.position.x - bounds.size.width, Math.round(24 * scaleFactor));
  }
});

test('restoring a large window on a smaller display keeps its entire outer frame visible', () => {
  const display = monitor({ width: 1280, height: 800,
    workArea: { position: { x: 0, y: 40 }, size: { width: 1280, height: 760 } } });
  const bounds = visibleWindowBounds({ position: { x: 2200, y: -1000 }, size: { width: 1600, height: 1000 } }, [display]);
  assertInside(bounds, display);
  assert.deepEqual(bounds, { position: { x: 0, y: 40 }, size: { width: 1280, height: 760 } });
});

test('missing display information fails before choosing unusable bounds', () => {
  assert.throws(() => miniRecorderBounds(null, []), /display work area/i);
  assert.throws(() => miniRecorderBounds(null, [monitor({ width: 0, height: 0 })]), /display work area/i);
});

test('entering the recorder corrects stale coordinates and exiting restores the main window', async () => {
  const f = fixture({ savedPosition: '{"x":5000,"y":3000}' });
  await f.mount();
  await act(async () => f.current.enterMini());
  assert.equal(f.current.isMini, true);
  assertInside(f.outerBounds(), f.monitors[0]);
  assert.equal(f.state.alwaysOnTop, true);
  assert.equal(f.state.decorations, false);
  assert.equal(f.state.resizable, false);
  const recorderPosition = { ...f.state.position };
  await act(async () => f.current.exitMini());
  assert.equal(f.current.isMini, false);
  assert.deepEqual(f.state.position, { x: 100, y: 120 });
  assert.deepEqual(f.state.size, { width: 900, height: 600 });
  assert.equal(f.state.alwaysOnTop, false);
  assert.equal(f.state.decorations, true);
  assert.equal(f.state.resizable, true);
  assert.deepEqual(JSON.parse(f.storage.get('mini-recorder-position')), recorderPosition);
  await f.unmount();
});

test('restoring after a monitor disconnect also fits window borders into the remaining display', async () => {
  const primary = monitor({ width: 1024, height: 768 });
  const secondary = monitor({ x: 1024, width: 2560, height: 1440 });
  const f = fixture({ monitors: [secondary, primary], position: { x: 1300, y: 200 }, size: { width: 1500, height: 1000 } });
  await f.mount();
  await act(async () => f.current.enterMini());
  f.monitors = [primary];
  await act(async () => f.current.exitMini());
  assert.equal(f.current.isMini, false);
  assertInside(f.outerBounds(), primary);
  assert.equal(f.state.size.width, primary.workArea.size.width - 16);
  assert.equal(f.state.size.height, primary.workArea.size.height - 39);
  await f.unmount();
});

test('a failed mini transition restores the original window and allows another attempt', async () => {
  let fail = true;
  const f = fixture({ beforeSet: async (name, value) => {
    if (name === 'setSize' && value.width === 232 && fail) {
      fail = false;
      throw new Error('Window sizing failed');
    }
  } });
  await f.mount();
  await act(async () => f.current.enterMini());
  assert.equal(f.current.isMini, false);
  assert.equal(f.errors.length, 1);
  assert.equal(f.state.decorations, true);
  assert.equal(f.state.resizable, true);
  assert.equal(f.state.alwaysOnTop, false);
  assert.deepEqual(f.state.position, { x: 100, y: 120 });
  assert.deepEqual(f.state.size, { width: 900, height: 600 });
  await act(async () => f.current.enterMini());
  assert.equal(f.current.isMini, true);
  await act(async () => f.current.exitMini());
  await f.unmount();
});

test('stopping while the mini transition is pending restores the main window after it finishes', async () => {
  let release;
  let reached;
  const pending = new Promise(resolve => { release = resolve; });
  const entering = new Promise(resolve => { reached = resolve; });
  const f = fixture({ recording: false, autoMini: true, beforeSet: async (name, value) => {
    if (name === 'setSize' && value.width === 232) {
      reached();
      await pending;
    }
  } });
  await f.mount();
  await f.setRecording(true);
  await entering;
  await f.setRecording(false);
  await act(async () => { release(); await pending; });
  assert.equal(f.current.isMini, false);
  assert.equal(f.state.decorations, true);
  assert.equal(f.state.alwaysOnTop, false);
  assert.deepEqual(f.state.position, { x: 100, y: 120 });
  assert.deepEqual(f.state.size, { width: 900, height: 600 });
  await f.unmount();
});

function monitor({ x = 0, y = 0, width = 1920, height = 1080, scaleFactor = 1, workArea } = {}) {
  return {
    name: `Display at ${x},${y}`,
    position: { x, y }, size: { width, height }, scaleFactor,
    workArea: workArea ?? { position: { x, y }, size: { width, height: Math.max(0, height - 40) } },
  };
}

function assertInside(bounds, display) {
  const area = display.workArea;
  assert.ok(bounds.position.x >= area.position.x, 'left edge is visible');
  assert.ok(bounds.position.y >= area.position.y, 'top edge is visible');
  assert.ok(bounds.position.x + bounds.size.width <= area.position.x + area.size.width, 'right edge is visible');
  assert.ok(bounds.position.y + bounds.size.height <= area.position.y + area.size.height, 'bottom edge is visible');
}

function fixture({ monitors = [monitor()], savedPosition, position = { x: 100, y: 120 },
  size = { width: 900, height: 600 }, recording = true, autoMini = false, beforeSet = async () => {} } = {}) {
  const calls = [];
  const errors = [];
  const storage = new Map([['mini-recorder-auto', String(autoMini)]]);
  if (savedPosition) storage.set('mini-recorder-position', savedPosition);
  const state = { position: { ...position }, size: { ...size }, decorations: true, resizable: true, alwaysOnTop: false, maximized: false };
  let current;
  let renderer;
  class PhysicalPosition { constructor(x, y) { this.x = x; this.y = y; } }
  class PhysicalSize { constructor(width, height) { this.width = width; this.height = height; } }
  const set = (method, field) => async value => {
    calls.push([method, value]);
    await beforeSet(method, value);
    state[field] = typeof value === 'object' ? { ...value } : value;
  };
  const outerSize = () => ({ width: state.size.width + (state.decorations ? 16 : 0), height: state.size.height + (state.decorations ? 39 : 0) });
  const win = {
    innerSize: async () => new PhysicalSize(state.size.width, state.size.height),
    outerSize: async () => outerSize(),
    outerPosition: async () => new PhysicalPosition(state.position.x, state.position.y),
    isMaximized: async () => state.maximized,
    unmaximize: async () => { calls.push(['unmaximize']); state.maximized = false; },
    maximize: async () => { calls.push(['maximize']); state.maximized = true; },
    setPosition: set('setPosition', 'position'), setSize: set('setSize', 'size'),
    setDecorations: set('setDecorations', 'decorations'),
    setResizable: set('setResizable', 'resizable'), setAlwaysOnTop: set('setAlwaysOnTop', 'alwaysOnTop'),
  };
  const api = load('contexts/MiniRecorderContext.tsx', {
    '@tauri-apps/api/window': {
      getCurrentWindow: () => win, PhysicalPosition, PhysicalSize,
      availableMonitors: async () => monitors,
      currentMonitor: async () => monitors[0] ?? null,
      primaryMonitor: async () => monitors[0] ?? null,
    },
    '@/lib/recorder-window': geometry,
    './RecordingStateContext': { useRecordingState: () => ({ isRecording: recording }) },
  }, {
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    console: { error: (...args) => errors.push(args) },
  });
  function Probe() { current = api.useMiniRecorder(); return null; }
  const tree = () => React.createElement(api.MiniRecorderProvider, null, React.createElement(Probe));
  return {
    calls, errors, state, storage,
    get current() { return current; },
    get monitors() { return monitors; },
    set monitors(value) { monitors = value; },
    outerBounds: () => ({ position: state.position, size: outerSize() }),
    async mount() { await act(async () => { renderer = create(tree()); }); },
    async unmount() { await act(async () => renderer.unmount()); },
    async setRecording(value) { recording = value; await act(async () => renderer.update(tree())); },
  };
}
