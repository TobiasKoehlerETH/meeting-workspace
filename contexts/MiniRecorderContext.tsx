'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { currentMonitor, getCurrentWindow, LogicalSize, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window';
import { useRecordingState } from './RecordingStateContext';

const MINI_SIZE = new LogicalSize(232, 48);
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

/** Top-right of the monitor's work area, unless the user dragged the mini recorder elsewhere before. */
async function miniPosition() {
  const saved = read(POSITION_KEY);
  if (saved) {
    const { x, y } = JSON.parse(saved);
    return new PhysicalPosition(x, y);
  }
  const monitor = await currentMonitor();
  if (!monitor) return new PhysicalPosition(24, 24);
  const { position, size } = monitor.workArea;
  const margin = 24 * monitor.scaleFactor;
  return new PhysicalPosition(position.x + size.width - MINI_SIZE.width * monitor.scaleFactor - margin, position.y + margin);
}

/**
 * Shrinks the main window into a small always-on-top recorder and restores it afterwards.
 * Recording stopping from anywhere (tray, mini view) restores the full window.
 */
export function MiniRecorderProvider({ children }: { children: React.ReactNode }) {
  const { isRecording } = useRecordingState();
  const [isMini, setIsMini] = useState(false);
  const [autoMini, setAutoMiniState] = useState(() => read(AUTO_KEY) === 'true');
  const restore = useRef<{ size: PhysicalSize; position: PhysicalPosition; maximized: boolean } | null>(null);
  const wasRecording = useRef(isRecording);

  const enterMini = useCallback(async () => {
    if (restore.current) return;
    const win = getCurrentWindow();
    try {
      restore.current = { size: await win.innerSize(), position: await win.outerPosition(), maximized: await win.isMaximized() };
      setIsMini(true);
      if (restore.current.maximized) await win.unmaximize();
      await win.setDecorations(false);
      await win.setResizable(false);
      await win.setAlwaysOnTop(true);
      await win.setSize(MINI_SIZE);
      await win.setPosition(await miniPosition());
    } catch (error) {
      console.error('Could not open the mini recorder:', error);
    }
  }, []);

  const exitMini = useCallback(async () => {
    const saved = restore.current;
    if (!saved) return;
    restore.current = null;
    const win = getCurrentWindow();
    try {
      const { x, y } = await win.outerPosition();
      write(POSITION_KEY, JSON.stringify({ x, y }));
      await win.setAlwaysOnTop(false);
      await win.setDecorations(true);
      await win.setResizable(true);
      await win.setSize(saved.size);
      await win.setPosition(saved.position);
      if (saved.maximized) await win.maximize();
    } catch (error) {
      console.error('Could not restore the main window:', error);
    }
    setIsMini(false);
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
