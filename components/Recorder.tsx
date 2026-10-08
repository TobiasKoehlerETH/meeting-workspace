'use client';

import { useState } from 'react';
import { Maximize2, Mic, Minimize2, Pause, Play, SlidersHorizontal, Square } from 'lucide-react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { PermissionWarning } from '@/components/PermissionWarning';
import { RecordingStatus, useRecordingClock, useRecordingState } from '@/contexts/RecordingStateContext';
import { useStopRecording } from '@/contexts/RecordingPostProcessingProvider';
import { useMiniRecorder } from '@/contexts/MiniRecorderContext';
import { useConfig } from '@/contexts/ConfigContext';
import { useRecordingStart } from '@/hooks/useRecordingStart';
import { usePermissionCheck } from '@/hooks/usePermissionCheck';
import { recordingService } from '@/services/recordingService';
import { formatEstimate, useTranscriptionEstimate } from '@/lib/transcription-estimate';
import { modelLabel } from '@/lib/speech-models';
import { formatClock, openSettings } from '@/lib/utils';

const BUSY = [RecordingStatus.STARTING, RecordingStatus.STOPPING, RecordingStatus.SAVING, RecordingStatus.PROCESSING_TRANSCRIPTS];
const ignore = () => {};

function explainStartError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/permission/i.test(message)) return 'Allow microphone access in system settings, then try again.';
  if (/system audio|speaker|output/i.test(message)) return 'System audio is unavailable. Check Settings > Recordings.';
  if (/mic|input/i.test(message)) return 'The microphone is unavailable or used by another app.';
  return message;
}

/** Runs an action once at a time and reports failures as toasts. */
function useAction() {
  const [pending, setPending] = useState(false);
  const run = async (action: () => Promise<unknown>, failure: string, explain = (e: unknown) => String(e)) => {
    if (pending) return;
    setPending(true);
    try { await action(); } catch (error) { toast.error(failure, { description: explain(error) }); }
    finally { setPending(false); }
  };
  return { pending, run };
}

const round = 'flex items-center justify-center rounded-full transition-colors disabled:opacity-50';

/** Full-window recorder: one button to start, a large clock and three controls while recording. */
export function Recorder() {
  const { isRecording, isPaused, status } = useRecordingState();
  const { activeDuration } = useRecordingClock();
  const { transcriptModelConfig: { model } } = useConfig();
  const { hasMicrophone, hasSystemAudio, isChecking, checkPermissions } = usePermissionCheck();
  const { handleRecordingStart } = useRecordingStart(isRecording, ignore);
  const stopRecording = useStopRecording();
  const { enterMini, autoMini, setAutoMini } = useMiniRecorder();
  const estimate = useTranscriptionEstimate();
  const { pending, run } = useAction();
  const busy = pending || BUSY.includes(status);

  if (!isRecording) {
    return <div className="flex h-screen flex-col items-center justify-center gap-8 px-4">
      <button type="button" aria-label="Start recording" disabled={busy}
        onClick={() => void run(handleRecordingStart, 'Recording could not start', explainStartError)}
        className={`${round} h-24 w-24 bg-red-600 text-white shadow-lg hover:bg-red-700`}>
        {pending || status === RecordingStatus.STARTING ? <span className="h-6 w-6 animate-spin rounded-full border-2 border-white border-b-transparent" /> : <Mic className="h-9 w-9" />}
      </button>
      <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-gray-600">
        <button type="button" className="flex items-center gap-2 hover:text-black" onClick={() => openSettings('recording')}>
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />Audio devices
        </button>
        <button type="button" className="hover:text-black" onClick={() => openSettings('transcription')}
          title="Expected processing time for one hour of audio on this device">
          {modelLabel(model)} · 1 h audio → {formatEstimate(estimate(model, 3600))}
        </button>
        <label className="flex items-center gap-2">
          <Switch checked={autoMini} onCheckedChange={setAutoMini} />Mini view while recording
        </label>
      </div>
      {!isChecking && <PermissionWarning hasMicrophone={hasMicrophone} hasSystemAudio={hasSystemAudio}
        onRecheck={checkPermissions} isRechecking={isChecking} />}
    </div>;
  }

  return <div className="flex h-screen flex-col items-center justify-center gap-6 px-4">
    <p role="status" className="flex items-center gap-2 text-sm text-gray-600">
      <span className={`h-2.5 w-2.5 rounded-full ${isPaused ? 'bg-orange-500' : 'animate-pulse bg-red-600'}`} />
      {isPaused ? 'Paused' : 'Recording'}
    </p>
    <p className="text-6xl font-light tabular-nums">{formatClock(activeDuration)}</p>
    <div className="flex items-center gap-4">
      <button type="button" aria-label={isPaused ? 'Resume recording' : 'Pause recording'} disabled={busy}
        onClick={() => void run(() => isPaused ? recordingService.resumeRecording() : recordingService.pauseRecording(), 'Could not change the pause state')}
        className={`${round} h-12 w-12 border border-gray-300 hover:bg-gray-100`}>
        {isPaused ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
      </button>
      <button type="button" aria-label="Stop recording" disabled={busy}
        onClick={() => void run(stopRecording, 'Could not stop recording')}
        className={`${round} h-16 w-16 bg-red-600 text-white shadow-lg hover:bg-red-700`}>
        <Square className="h-6 w-6 fill-current" />
      </button>
      <button type="button" aria-label="Mini view" title="Mini view: a small always-on-top stop button" disabled={busy}
        onClick={() => void enterMini()} className={`${round} h-12 w-12 border border-gray-300 hover:bg-gray-100`}>
        <Minimize2 className="h-5 w-5" />
      </button>
    </div>
    <p className="text-sm text-gray-500">Audio is saved when you stop. Transcribing it with {modelLabel(model)} takes {formatEstimate(estimate(model, activeDuration ?? 0))}.</p>
  </div>;
}

/** The whole window while minimized: drag anywhere, timer, stop, expand. */
export function MiniRecorder() {
  const { isPaused } = useRecordingState();
  const { activeDuration } = useRecordingClock();
  const stopRecording = useStopRecording();
  const { exitMini } = useMiniRecorder();
  const { pending, run } = useAction();

  return <div data-tauri-drag-region className="ap-mini-recorder flex h-screen select-none items-center gap-3 border-t-[3px] border-[var(--ap-rule-red)] bg-white px-3">
    <span data-tauri-drag-region className={`h-2.5 w-2.5 shrink-0 rounded-full ${isPaused ? 'bg-orange-500' : 'animate-pulse bg-red-600'}`} />
    <span data-tauri-drag-region className="flex-1 text-sm tabular-nums">{formatClock(activeDuration)}</span>
    <button type="button" disabled={pending} onClick={() => void run(async () => { await exitMini(); await stopRecording(); }, 'Could not stop recording')}
      className="flex items-center gap-1.5 rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
      <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />Stop
    </button>
    <button type="button" aria-label="Open full window" title="Open full window" onClick={() => void exitMini()}
      className="rounded p-1.5 text-gray-600 hover:bg-gray-100">
      <Maximize2 className="h-4 w-4" />
    </button>
  </div>;
}
