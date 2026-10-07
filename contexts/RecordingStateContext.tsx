'use client';

import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { recordingService } from '@/services/recordingService';
import type { TranscriptProgress } from '@/lib/finalize-transcript';

/**
 * Recording state synchronized with backend
 * This context provides a single source of truth for recording state
 * that automatically syncs with the Rust backend, solving:
 * 1. Page refresh desync (backend recording but UI shows stopped)
 * 2. Pause state visibility across components
 * 3. Comprehensive state for future features (reconnection, etc.)
 */

// Recording lifecycle status enum
export enum RecordingStatus {
  IDLE = 'idle',                          // Not recording
  STARTING = 'starting',                  // Initiating recording
  RECORDING = 'recording',                // Active recording
  STOPPING = 'stopping',                  // Stop initiated, waiting for backend
  PROCESSING_TRANSCRIPTS = 'processing',  // Transcription completion wait
  SAVING = 'saving',                      // Saving to database
  COMPLETED = 'completed',                // Successfully saved
  ERROR = 'error'                         // Error occurred
}

interface RecordingState {
  isRecording: boolean;           // Is a recording session active
  isPaused: boolean;              // Is the recording paused
  isActive: boolean;              // Is actively recording (recording && !paused)
  recordingDuration: number | null;  // Total duration including pauses
  activeDuration: number | null;     // Active recording time (excluding pauses)

  // NEW: Lifecycle status
  status: RecordingStatus;
  statusMessage?: string;  // Optional message for current status
  transcriptProgress: TranscriptProgress | null;
}

interface RecordingStateContextType extends Omit<RecordingState, 'recordingDuration' | 'activeDuration' | 'transcriptProgress'> {
  // NEW: Setters for status management
  setStatus: (status: RecordingStatus, message?: string) => void;
  setTranscriptProgress: (progress: TranscriptProgress | null) => void;

  // Computed helpers (derived from status)
  isStopping: boolean;
  isProcessing: boolean;
  isSaving: boolean;
}

const RecordingStateContext = createContext<RecordingStateContextType | null>(null);
const RecordingClockContext = createContext<Pick<RecordingState, 'recordingDuration' | 'activeDuration'>>({ recordingDuration: null, activeDuration: null });
const TranscriptProgressContext = createContext<TranscriptProgress | null>(null);

export const useRecordingClock = () => useContext(RecordingClockContext);
export const useTranscriptProgress = () => useContext(TranscriptProgressContext);

export const useRecordingState = () => {
  const context = useContext(RecordingStateContext);
  if (!context) {
    throw new Error('useRecordingState must be used within a RecordingStateProvider');
  }
  return context;
};

export function RecordingStateProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<RecordingState>({
    isRecording: false, isPaused: false, isActive: false,
    recordingDuration: null, activeDuration: null, status: RecordingStatus.IDLE, transcriptProgress: null,
  });
  const mountedRef = useRef(false);
  const syncingRef = useRef(false);
  const revisionRef = useRef(0);

  const setStatus = useCallback((status: RecordingStatus, message?: string) => {
    const clearProgress = [RecordingStatus.IDLE, RecordingStatus.STARTING, RecordingStatus.ERROR].includes(status);
    setState(prev => prev.status === status && prev.statusMessage === message
      && (!clearProgress || prev.transcriptProgress === null)
      ? prev : { ...prev, status, statusMessage: message, transcriptProgress: clearProgress ? null : prev.transcriptProgress });
  }, []);

  const setTranscriptProgress = useCallback((transcriptProgress: TranscriptProgress | null) => {
    setState(prev => ({ ...prev, transcriptProgress }));
  }, []);

  const syncWithBackend = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    const revision = revisionRef.current;
    try {
      const backend = await recordingService.getRecordingState();
      // A start/stop/pause event takes precedence over a request issued before it.
      if (!mountedRef.current || revision !== revisionRef.current) return;
      setState(prev => {
        const next = {
          ...prev,
          isRecording: backend.is_recording, isPaused: backend.is_paused,
          isActive: backend.is_active, recordingDuration: backend.recording_duration,
          activeDuration: backend.active_duration,
        };
        if (backend.is_recording && prev.status === RecordingStatus.IDLE) {
          next.status = RecordingStatus.RECORDING;
        }
        return Object.keys(next).every(key => next[key as keyof RecordingState] === prev[key as keyof RecordingState])
          ? prev : next;
      });
    } catch (error) {
      console.error('Failed to sync recording state:', error);
    } finally {
      syncingRef.current = false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const unsubscribers: (() => void)[] = [];
    let disposed = false;
    const register = async (listener: Promise<() => void>) => {
      const unlisten = await listener;
      if (disposed) unlisten();
      else unsubscribers.push(unlisten);
    };
    const update = (change: (prev: RecordingState) => RecordingState) => {
      if (disposed) return;
      revisionRef.current += 1;
      setState(change);
    };
    const listeners = [
      recordingService.onRecordingStarted(() => update(prev => ({
        ...prev, isRecording: true, isPaused: false, isActive: true,
        recordingDuration: 0, activeDuration: 0,
        status: RecordingStatus.RECORDING, statusMessage: undefined, transcriptProgress: null,
      }))),
      recordingService.onRecordingStopped(() => update(prev => {
        const stopping = [RecordingStatus.STOPPING, RecordingStatus.PROCESSING_TRANSCRIPTS,
          RecordingStatus.SAVING].includes(prev.status);
        return {
          ...prev, isRecording: false, isPaused: false, isActive: false,
          recordingDuration: null, activeDuration: null,
          status: stopping ? prev.status : RecordingStatus.STOPPING,
          statusMessage: stopping ? prev.statusMessage : 'Stopping recording...',
        };
      })),
      recordingService.onRecordingPaused(() => update(prev => ({ ...prev, isPaused: true, isActive: false }))),
      recordingService.onRecordingResumed(() => update(prev => ({ ...prev, isPaused: false, isActive: true }))),
    ];
    listeners.forEach(listener => { void register(listener).catch(error => console.error('Failed to register recording listener:', error)); });
    void syncWithBackend();
    return () => {
      disposed = true;
      mountedRef.current = false;
      revisionRef.current += 1;
      unsubscribers.forEach(unlisten => unlisten());
    };
  }, [syncWithBackend]);

  useEffect(() => {
    if (!state.isRecording) return;
    const interval = setInterval(syncWithBackend, 1000);
    return () => clearInterval(interval);
  }, [state.isRecording, syncWithBackend]);

  useEffect(() => {
    if (state.status !== RecordingStatus.COMPLETED) return;
    const timer = setTimeout(() => setStatus(RecordingStatus.IDLE), 2000);
    return () => clearTimeout(timer);
  }, [state.status, setStatus]);

  const { recordingDuration, activeDuration, transcriptProgress, ...lifecycle } = state;
  const clock = useMemo(() => ({ recordingDuration, activeDuration }), [recordingDuration, activeDuration]);
  const value = useMemo(() => ({
    ...lifecycle, setStatus, setTranscriptProgress,
    isStopping: state.status === RecordingStatus.STOPPING,
    isProcessing: state.status === RecordingStatus.PROCESSING_TRANSCRIPTS,
    isSaving: state.status === RecordingStatus.SAVING,
  }), [state.isRecording, state.isPaused, state.isActive, state.status, state.statusMessage, setStatus, setTranscriptProgress]);

  return <RecordingStateContext.Provider value={value}>
    <RecordingClockContext.Provider value={clock}>
      <TranscriptProgressContext.Provider value={transcriptProgress}>{children}</TranscriptProgressContext.Provider>
    </RecordingClockContext.Provider>
  </RecordingStateContext.Provider>;
}
