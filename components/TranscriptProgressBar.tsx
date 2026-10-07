'use client';

import { RecordingStatus, useRecordingState, useTranscriptProgress } from '@/contexts/RecordingStateContext';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';

/** One global status bar also covers recordings stopped from the tray or another page. */
export function TranscriptProgressBar() {
  const { status, statusMessage, isRecording } = useRecordingState();
  const transcriptProgress = useTranscriptProgress();
  const { isCollapsed } = useSidebar();
  const completed = status === RecordingStatus.COMPLETED && transcriptProgress?.percentage === 100;
  const processing = status === RecordingStatus.PROCESSING_TRANSCRIPTS;
  if (isRecording || (!completed && !processing && status !== RecordingStatus.SAVING && status !== RecordingStatus.STOPPING)) return null;

  const progress = processing || completed ? transcriptProgress : null;
  const title = completed ? 'Transcript ready' : processing ? 'Finalizing transcript' : 'Saving recording';
  const message = progress?.message || statusMessage || (processing ? 'Processing the recording locally…' : 'Saving original audio…');

  return <div className={`pointer-events-none fixed inset-x-0 bottom-4 z-40 px-4 ${isCollapsed ? 'md:pl-20' : 'md:pl-72'}`}>
    <section aria-label="Transcript finalization status" className="mx-auto w-full max-w-xl rounded-xl border border-gray-200 bg-white p-4 shadow-lg">
      <div className="mb-2 flex items-center justify-between gap-4 text-sm font-semibold text-gray-900">
        <span>{title}</span>
        {progress && <span className="tabular-nums">{progress.percentage}%</span>}
      </div>
      <div role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={progress?.percentage} aria-valuetext={progress ? `${progress.percentage}% — ${message}` : message}
        className="h-2 overflow-hidden rounded-full bg-gray-100">
        <div className={`h-full rounded-full bg-gray-900 ${progress ? 'transition-[width] duration-300 motion-reduce:transition-none' : 'w-full animate-pulse motion-reduce:animate-none'}`}
          style={progress ? { width: `${progress.percentage}%` } : undefined} />
      </div>
      <p role="status" className="mt-2 text-sm text-gray-600">{message}</p>
      {processing && <p className="mt-1 text-xs text-gray-500">Runs on this device. Progress follows processing stages, not time remaining.</p>}
    </section>
  </div>;
}
