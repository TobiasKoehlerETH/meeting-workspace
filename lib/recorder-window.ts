import type { Monitor } from '@tauri-apps/api/window';

interface Point { x: number; y: number }
interface Size { width: number; height: number }
export interface WindowBounds { position: Point; size: Size }

const MINI_SIZE = { width: 232, height: 48 };

/** Saved coordinates belong to a previous display arrangement and may no longer be usable. */
export function miniRecorderBounds(savedPosition: Point | null, monitors: Monitor[]): WindowBounds {
  const monitor = selectMonitor(savedPosition, MINI_SIZE, monitors);
  const size = {
    width: Math.round(MINI_SIZE.width * monitor.scaleFactor),
    height: Math.round(MINI_SIZE.height * monitor.scaleFactor),
  };
  const area = monitor.workArea;
  const margin = Math.round(24 * monitor.scaleFactor);
  const position = savedPosition && overlap(savedPosition, size, monitor) > 0 ? savedPosition : {
    x: area.position.x + area.size.width - size.width - margin,
    y: area.position.y + margin,
  };
  return fitToMonitor({ position, size }, monitor);
}

/** Keep the whole outer window, including its title bar, inside a connected work area. */
export function visibleWindowBounds(bounds: WindowBounds, monitors: Monitor[]): WindowBounds {
  return fitToMonitor(bounds, selectMonitor(bounds.position, bounds.size, monitors));
}

export function parseWindowPosition(saved: string | null): Point | null {
  try {
    const position = JSON.parse(saved ?? 'null');
    return position && Number.isFinite(position.x) && Number.isFinite(position.y)
      ? { x: Math.round(position.x), y: Math.round(position.y) } : null;
  } catch {
    return null;
  }
}

function selectMonitor(position: Point | null, size: Size, monitors: Monitor[]): Monitor {
  const available = monitors.filter(monitor => monitor.workArea.size.width > 0 && monitor.workArea.size.height > 0);
  if (!available.length) throw new Error('No display work area is available. Try opening the recorder again.');
  if (!position) return available[0];
  // The caller puts the current (or primary) monitor first for disconnected-screen recovery.
  return available.reduce((best, monitor) =>
    overlap(position, size, monitor) > overlap(position, size, best) ? monitor : best);
}

function overlap(position: Point, size: Size, monitor: Monitor): number {
  const area = monitor.workArea;
  const width = Math.max(0, Math.min(position.x + size.width, area.position.x + area.size.width) - Math.max(position.x, area.position.x));
  const height = Math.max(0, Math.min(position.y + size.height, area.position.y + area.size.height) - Math.max(position.y, area.position.y));
  return width * height;
}

function fitToMonitor(bounds: WindowBounds, monitor: Monitor): WindowBounds {
  const area = monitor.workArea;
  const size = {
    width: Math.min(bounds.size.width, area.size.width),
    height: Math.min(bounds.size.height, area.size.height),
  };
  return {
    size,
    position: {
      x: Math.round(Math.max(area.position.x, Math.min(bounds.position.x, area.position.x + area.size.width - size.width))),
      y: Math.round(Math.max(area.position.y, Math.min(bounds.position.y, area.position.y + area.size.height - size.height))),
    },
  };
}
