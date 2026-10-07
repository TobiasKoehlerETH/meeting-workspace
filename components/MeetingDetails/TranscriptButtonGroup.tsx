'use client';

import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, FolderOpen, FileText } from 'lucide-react';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import { finalizeTranscript } from '@/lib/finalize-transcript';
import { toast } from 'sonner';

interface TranscriptButtonGroupProps {
  transcriptCount: number;
  onCopyTranscript: () => void;
  onOpenMeetingFolder: () => Promise<void>;
  meetingId?: string;
  meetingFolderPath?: string | null;
  onRefetchTranscripts?: () => Promise<void>;
}

export function TranscriptButtonGroup({
  transcriptCount, onCopyTranscript, onOpenMeetingFolder,
  meetingId, meetingFolderPath, onRefetchTranscripts,
}: TranscriptButtonGroupProps) {
  const { status, isRecording, isProcessing, isStopping, isSaving, setStatus, setTranscriptProgress } = useRecordingState();
  const starting = useRef(false);
  const busy = isRecording || isProcessing || isStopping || isSaving || status === RecordingStatus.STARTING;

  async function transcribe() {
    if (busy || starting.current || !meetingId || !meetingFolderPath) return;
    starting.current = true;
    setStatus(RecordingStatus.PROCESSING_TRANSCRIPTS, 'Preparing local transcription…');
    try {
      await finalizeTranscript(meetingId, meetingFolderPath, setTranscriptProgress);
      setStatus(RecordingStatus.COMPLETED);
      await onRefetchTranscripts?.();
      window.dispatchEvent(new CustomEvent('meeting-transcribed', { detail: { meetingId } }));
    } catch (error) {
      setStatus(RecordingStatus.ERROR, String(error));
      toast.error('Transcription could not finish', { description: `${String(error)} Your original recording is still saved.` });
    } finally { starting.current = false; }
  }

  return <div className="flex flex-wrap items-center gap-2">
    {meetingId && meetingFolderPath && <Button size="sm" disabled={busy}
      onClick={() => void transcribe()} title="Transcribe locally using Settings > Transcription">
      <FileText size={16} className="mr-1" />
      {isProcessing ? 'Transcribing…' : transcriptCount ? 'Transcribe again' : 'Transcribe'}
    </Button>}
    <Button variant="outline" size="sm" onClick={onCopyTranscript}
      disabled={transcriptCount === 0} aria-label="Copy transcript" title="Copy transcript"><Copy size={16} /></Button>
    <Button variant="outline" size="sm" onClick={() => void onOpenMeetingFolder()}
      aria-label="Open recording folder" title="Open recording folder"><FolderOpen size={16} /></Button>
  </div>;
}
