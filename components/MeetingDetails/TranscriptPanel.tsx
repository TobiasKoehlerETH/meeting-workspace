"use client";

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { TranscriptSegmentData } from '@/types';
import { VirtualizedTranscriptView } from '@/components/VirtualizedTranscriptView';
import { useConfig } from '@/contexts/ConfigContext';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { formatEstimate, useTranscriptionEstimate } from '@/lib/transcription-estimate';
import { modelLabel } from '@/lib/speech-models';
import { formatClock } from '@/lib/utils';
import { TranscriptButtonGroup } from './TranscriptButtonGroup';
import { SpeakerNames } from './SpeakerNames';
import { RecordingPlayer } from './RecordingPlayer';

interface TranscriptPanelProps {
  segments: TranscriptSegmentData[];
  customPrompt: string;
  onPromptChange: (value: string) => void;
  onCopyTranscript: () => void;
  onOpenMeetingFolder: () => Promise<void>;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;
  meetingId?: string;
  meetingFolderPath?: string | null;
  onRefetchTranscripts?: () => Promise<void>;
}

/** Expected time to transcribe this recording with the selected model. */
function TranscribeEstimate({ meetingId }: { meetingId: string }) {
  const { transcriptModelConfig: { model } } = useConfig();
  const { isProcessing } = useRecordingState();
  const estimate = useTranscriptionEstimate();
  const [duration, setDuration] = useState<number | null>(null);
  useEffect(() => {
    let open = true;
    invoke<number>('get_meeting_audio_duration', { meetingId })
      .then(value => { if (open) setDuration(value); }).catch(() => {});
    return () => { open = false; };
  }, [meetingId]);
  if (!duration || isProcessing) return null;
  return <p className="mt-2 text-xs text-gray-500">
    {formatClock(duration)} audio &middot; {modelLabel(model)} &rarr; {formatEstimate(estimate(model, duration))}
  </p>;
}

export function TranscriptPanel({
  segments, customPrompt, onPromptChange, onCopyTranscript, onOpenMeetingFolder,
  hasMore, isLoadingMore, totalCount, loadedCount, onLoadMore, meetingId, meetingFolderPath, onRefetchTranscripts,
}: TranscriptPanelProps) {
  return (
    <div className="flex w-full md:w-80 lg:w-96 min-w-0 border-r border-gray-200 bg-white flex-col relative shrink-0">
      <div className="p-4 border-b border-gray-200">
        <TranscriptButtonGroup
          transcriptCount={totalCount ?? segments.length}
          onCopyTranscript={onCopyTranscript}
          onOpenMeetingFolder={onOpenMeetingFolder}
          meetingId={meetingId}
          meetingFolderPath={meetingFolderPath}
          onRefetchTranscripts={onRefetchTranscripts}
        />
        {meetingId && meetingFolderPath && <TranscribeEstimate meetingId={meetingId} />}
        {meetingId && segments.length > 0 && <SpeakerNames meetingId={meetingId}
          revision={segments[0]?.id ?? ''} onChanged={onRefetchTranscripts} />}
        {meetingId && meetingFolderPath && <RecordingPlayer key={meetingId} meetingId={meetingId} />}
      </div>

      <div className="flex-1 overflow-hidden pb-4">
        {segments.length === 0
          ? <p className="p-4 text-sm text-gray-600">Audio saved. Select Transcribe to create a transcript.</p>
          : <VirtualizedTranscriptView segments={segments} hasMore={hasMore} isLoadingMore={isLoadingMore}
            totalCount={totalCount} loadedCount={loadedCount} onLoadMore={onLoadMore} />}
      </div>

      {segments.length > 0 && (
        <div className="p-1 border-t border-gray-200">
          <textarea
            aria-label="Summary context"
            placeholder="Summary context (optional)"
            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm min-h-[80px] resize-y"
            value={customPrompt}
            onChange={(e) => onPromptChange(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
