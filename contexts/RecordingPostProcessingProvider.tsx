'use client';

import React, { createContext, useCallback, useContext, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { appDataDir } from '@tauri-apps/api/path';
import { recordingService } from '@/services/recordingService';
import { useRecordingStop } from '@/hooks/useRecordingStop';
import { TranscriptProgressBar } from '@/components/TranscriptProgressBar';

const StopRecordingContext = createContext<() => Promise<void>>(async () => {});

/** Stop capture and save the meeting; shared by the main view and the mini recorder. */
export const useStopRecording = () => useContext(StopRecordingContext);

/**
 * Saves a stopped recording as a meeting, whichever control stopped it:
 * the tray emits 'recording-stop-complete', in-app controls call useStopRecording().
 */
export function RecordingPostProcessingProvider({ children }: { children: React.ReactNode }) {
  const { handleRecordingStop } = useRecordingStop();

  useEffect(() => {
    const unlisten = listen<boolean>('recording-stop-complete', event => void handleRecordingStop(event.payload));
    return () => void unlisten.then(fn => fn());
  }, [handleRecordingStop]);

  const stopRecording = useCallback(async () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    // 'recording-stopped' carries the folder path; saving must wait for it.
    let unlisten: (() => void) | undefined;
    const stopped = new Promise<void>(resolve => {
      void listen('recording-stopped', () => resolve()).then(fn => { unlisten = fn; });
      setTimeout(resolve, 5000);
    });
    try {
      await recordingService.stopRecording(`${await appDataDir()}/recording-${timestamp}.wav`);
      await stopped;
    } catch (error) {
      if (String(error).includes('No recording in progress')) return;
      await handleRecordingStop(false);
      throw error;
    } finally {
      unlisten?.();
    }
    await handleRecordingStop(true);
  }, [handleRecordingStop]);

  return <StopRecordingContext.Provider value={stopRecording}>
    {children}<TranscriptProgressBar />
  </StopRecordingContext.Provider>;
}
