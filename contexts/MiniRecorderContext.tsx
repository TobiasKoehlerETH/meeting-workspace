'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { availableMonitors, currentMonitor, primaryMonitor, getCurrentWindow, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window';
import type { Monitor } from '@tauri-apps/api/window';
import { miniRecorderBounds, parseWindowPosition, visibleWindowBounds } from '@/lib/recorder-window';
import { useRecordingState } from './RecordingStateContext';

const AUTO_KEY = 'mini-recorder-auto';
const POSITION_KEY = 'mini-recorder-position';

interface MiniRecorder {
  isMini: boolean;
  autoMini: boolean;
  setAutoMini: (value: boolean) => void;
  enterMini: () => Promise<void>;
  exitMini: () => Promise<void>;
}

const MiniRecorderContext = createContext<MiniRecorder | null>(null);

export function useMiniRecorder() {
  const context = useContext(MiniRecorderContext);
  if (!context) throw new Error('useMiniRecorder must be used within MiniRecorderProvider');
  return context;
}

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* convenience only */ } };

async function connectedMonitors(): Promise<Monitor[]> {
  const [monitors, current, primary] = await Promise.all([availableMonitors(), currentMonitor(), primaryMonitor()]);
  const preferred = current ?? primary;
  return preferred ? [preferred, ...monitors] : monitors;
}

interface SavedWindow {
  size: PhysicalSize;
  position: PhysicalPosition;
  maximized: boolean;
}

async function restoreWindow(saved: SavedWindow) {
  const monitors = await connectedMonitors();
  const initial = visibleWindowBounds(saved, monitors);
  const win = getCurrentWindow();
  await win.setAlwaysOnTop(false);
  await win.setDecorations(true);
  await win.setResizable(true);
  await win.setPosition(new PhysicalPosition(initial.position.x, initial.position.y));
  await win.setSize(new PhysicalSize(initial.size.width, initial.size.height));
  const outerSize = await win.outerSize();
  const innerSize = await win.innerSize();
  const bounds = visibleWindowBounds({ position: initial.position, size: outerSize }, monitors);
  await win.setSize(new PhysicalSize(
    Math.max(1, bounds.size.width - (outerSize.width - innerSize.width)),
    Math.max(1, bounds.size.height - (outerSize.height - innerSize.height)),
  ));
  await win.setPosition(new PhysicalPosition(bounds.position.x, bounds.position.y));
  if (saved.maximized) await win.maximize();
}

/**
 * Shrinks the main window into a small always-on-top recorder and restores it afterwards.
 * Recording stopping from anywhere (tray, mini view) restores the full window.
 */
export function MiniRecorderProvider({ children }: { children: React.ReactNode }) {
  const { isRecording } = useRecordingState();
  const [isMini, setIsMini] = useState(false);
  const [autoMini, setAutoMiniState] = useState(() => read(AUTO_KEY) === 'true');
  const restore = useRef<SavedWindow | null>(null);
  const transition = useRef(Promise.resolve());
  const wasRecording = useRef(isRecording);

  const enterMini = useCallback(() => {
    transition.current = transition.current.then(async () => {
      if (restore.current) return;
      const win = getCurrentWindow();
      try {
        const bounds = miniRecorderBounds(parseWindowPosition(read(POSITION_KEY)), await connectedMonitors());
        restore.current = { size: await win.innerSize(), position: await win.outerPosition(), maximized: await win.isMaximized() };
        if (restore.current.maximized) await win.unmaximize();
        await win.setDecorations(false);
        await win.setResizable(false);
        await win.setAlwaysOnTop(true);
        // Move before sizing so a different monitor's DPI applies to the mini recorder.
        await win.setPosition(new PhysicalPosition(bounds.position.x, bounds.position.y));
        await win.setSize(new PhysicalSize(bounds.size.width, bounds.size.height));
        await win.setPosition(new PhysicalPosition(bounds.position.x, bounds.position.y));
        setIsMini(true);
      } catch (error) {
        console.error('Could not open the mini recorder:', error);
        if (restore.current) {
          try {
            await restoreWindow(restore.current);
            restore.current = null;
            setIsMini(false);
          } catch (restoreError) {
            console.error('Could not restore the main window:', restoreError);
            setIsMini(true);
          }
        }
      }
    });
    return transition.current;
  }, []);

  const exitMini = useCallback(() => {
    transition.current = transition.current.then(async () => {
      const saved = restore.current;
      if (!saved) return;
      const win = getCurrentWindow();
      try {
        const { x, y } = await win.outerPosition();
        write(POSITION_KEY, JSON.stringify({ x, y }));
        await restoreWindow(saved);
        restore.current = null;
        setIsMini(false);
      } catch (error) {
        console.error('Could not restore the main window:', error);
      }
    });
    return transition.current;
  }, []);

  // Enter on a fresh start when the user prefers it; leave whenever recording ends.
  useEffect(() => {
    if (isRecording && !wasRecording.current && autoMini) void enterMini();
    if (!isRecording && isMini) void exitMini();
    wasRecording.current = isRecording;
  }, [isRecording, isMini, autoMini, enterMini, exitMini]);

  const setAutoMini = useCallback((value: boolean) => {
    setAutoMiniState(value);
    write(AUTO_KEY, String(value));
  }, []);

  const value = useMemo(() => ({ isMini, autoMini, setAutoMini, enterMini, exitMini }),
    [isMini, autoMini, setAutoMini, enterMini, exitMini]);
  return <MiniRecorderContext.Provider value={value}>{children}</MiniRecorderContext.Provider>;
}
