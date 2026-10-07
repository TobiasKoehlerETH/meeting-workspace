import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface TranscriptProgress {
  percentage: number;
  message: string;
}

interface ProgressEvent {
  meeting_id: string;
  progress_percentage: number;
  message: string;
}

/** Subscribe before starting the batch job so its first progress event is visible. */
export async function finalizeTranscript(
  meetingId: string,
  meetingFolderPath: string,
  onProgress: (progress: TranscriptProgress | null) => void,
): Promise<void> {
  let active = true;
  let percentage = 0;
  let unlisten: (() => void) | undefined;
  onProgress({ percentage, message: 'Preparing local transcription…' });
  try {
    try {
      unlisten = await listen<ProgressEvent>('retranscription-progress', ({ payload }) => {
        if (!active || payload.meeting_id !== meetingId || !Number.isFinite(payload.progress_percentage)) return;
        // The backend's final event precedes model cleanup; show 100% only when the command succeeds.
        percentage = Math.max(percentage, Math.min(99, Math.max(0, Math.round(payload.progress_percentage))));
        onProgress({ percentage, message: payload.progress_percentage >= 100
          ? 'Finishing local transcription…' : payload.message });
      });
    } catch (error) {
      console.error('Could not subscribe to transcript progress:', error);
      onProgress(null);
    }
    await invoke('finalize_local_transcript', { meetingId, meetingFolderPath });
    onProgress({ percentage: 100, message: 'Transcript ready' });
  } catch (error) {
    onProgress(null);
    throw error;
  } finally {
    active = false;
    unlisten?.();
  }
}
