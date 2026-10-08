import { useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { listen } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import { storageService } from '@/services/storageService';
import {
  applyPinnedSummaryLanguageToMeeting,
} from '@/lib/summary-language-preferences';

// The page and the global tray handler share this job; one recording must create one meeting.
let stopInProgress = false;

/** Saves the original audio as a meeting after capture stops. Transcription starts only on request. */
export function useRecordingStop() {
  const { setStatus, setTranscriptProgress } = useRecordingState();

  const {
    meetingTitle,
    markMeetingAsSaved,
  } = useTranscripts();

  const {
    refetchMeetings,
    setCurrentMeeting,
  } = useSidebar();

  const router = useRouter();

  // Promise to track recording-stopped event data (fixes race condition with recording-stop-complete)
  const recordingStoppedDataRef = useRef<Promise<void> | null>(null);

  // Set up recording-stopped listener for meeting navigation
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;
    let disposed = false;

    const setupRecordingStoppedListener = async () => {
      try {
        unlistenFn = await listen<{
          message: string;
          folder_path?: string;
          meeting_name?: string;
        }>('recording-stopped', async (event) => {
          if (disposed) return;
          // Create promise that resolves when sessionStorage is set (prevents race condition)
          recordingStoppedDataRef.current = (async () => {
            const { folder_path, meeting_name } = event.payload;

            // Store folder_path and meeting_name for later use in handleRecordingStop
            if (folder_path) {
              sessionStorage.setItem('last_recording_folder_path', folder_path);
            }
            if (meeting_name) {
              sessionStorage.setItem('last_recording_meeting_name', meeting_name);
            }
          })();

        });
        if (disposed) unlistenFn();
      } catch (error) {
        console.error('Failed to setup recording stopped listener:', error);
      }
    };

    setupRecordingStoppedListener();

    return () => {
      disposed = true;
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, [router]);

  // Main recording stop handler
  const handleRecordingStop = useCallback(async (isCallApi: boolean) => {
    if (recordingStoppedDataRef.current) {
      await recordingStoppedDataRef.current;
    }

    // Guard: prevent duplicate/concurrent stop calls
    if (stopInProgress) {
      return;
    }
    stopInProgress = true;
    setTranscriptProgress(null);

    // Set status to STOPPING immediately
    setStatus(RecordingStatus.STOPPING);
    try {
      // Capture has stopped and the WAV is already on disk. Persist the meeting
      // before inference so it can be recovered even when the model fails.
      if (isCallApi) {

        setStatus(RecordingStatus.SAVING, 'Saving meeting to database...');

        // Get folder_path and meeting_name from recording-stopped event
        const folderPath = sessionStorage.getItem('last_recording_folder_path');
        const savedMeetingName = sessionStorage.getItem('last_recording_meeting_name');

        try {
          const responseData = await storageService.saveMeeting(
            savedMeetingName || meetingTitle || 'New Meeting',  // PREFER savedMeetingName (backend source)
            [],
            folderPath
          );

          const meetingId = responseData.meeting_id;
          if (!meetingId) {
            console.error('No meeting_id in response:', responseData);
            throw new Error('No meeting ID received from save operation');
          }

          try {
            await applyPinnedSummaryLanguageToMeeting(meetingId);
          } catch (error) {
            console.warn('Failed to apply pinned summary language preference for new meeting:', error);
            toast.warning('Could not apply default summary language', {
              description: 'The meeting was saved, but the default summary language was not applied.',
            });
          }

          // Mark meeting as saved in IndexedDB (for recovery system)
          await markMeetingAsSaved();

          // Clean up session storage
          sessionStorage.removeItem('last_recording_folder_path');
          sessionStorage.removeItem('last_recording_meeting_name');
          // Clean up IndexedDB meeting ID (redundant with markMeetingAsSaved cleanup, but ensures cleanup)
          sessionStorage.removeItem('indexeddb_current_meeting_id');

          // Refetch meetings and set current meeting
          await refetchMeetings();

          try {
            const meetingData = await storageService.getMeeting(meetingId);
            if (meetingData) {
              setCurrentMeeting({
                id: meetingId,
                title: meetingData.title
              });
              console.log('✅ Current meeting set:', meetingData.title);
            }
          } catch (error) {
            console.warn('Could not fetch meeting details, using ID only:', error);
            setCurrentMeeting({ id: meetingId, title: savedMeetingName || meetingTitle || 'New Meeting' });
          }

          // Mark as completed
          setStatus(RecordingStatus.COMPLETED);

          toast.success('Recording saved', { description: 'Click Transcribe when you are ready.' });
          router.push(`/meeting-details?id=${meetingId}`);
          setStatus(RecordingStatus.IDLE);

        } catch (saveError) {
          console.error('Failed to save meeting to database:', saveError);
          setStatus(RecordingStatus.ERROR, saveError instanceof Error ? saveError.message : 'Unknown error');
          toast.error('Failed to save meeting', {
            description: saveError instanceof Error ? saveError.message : 'Unknown error'
          });
          throw saveError;
        }
      } else {
        // No save needed, go back to IDLE
        setStatus(RecordingStatus.IDLE);
      }

    } catch (error) {
      console.error('Error in handleRecordingStop:', error);
      setStatus(RecordingStatus.ERROR, error instanceof Error ? error.message : 'Unknown error');
    } finally {
      // Always reset the guard flag when done
      stopInProgress = false;
    }
  }, [
    setStatus,
    setTranscriptProgress,
    meetingTitle,
    markMeetingAsSaved,
    refetchMeetings,
    setCurrentMeeting,
    router,
  ]);

  return { handleRecordingStop };
}
