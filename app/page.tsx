'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Recorder } from '@/components/Recorder';
import { TranscriptRecovery } from '@/components/TranscriptRecovery';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useTranscriptRecovery } from '@/hooks/useTranscriptRecovery';
import { indexedDBService } from '@/services/indexedDBService';

const RECOVERY_SHOWN = 'recovery_dialog_shown';

export default function Home() {
  const router = useRouter();
  const { isRecording } = useRecordingState();
  const { refetchMeetings } = useSidebar();
  const recovery = useTranscriptRecovery();
  const { recoverableMeetings, checkForRecoverableTranscripts } = recovery;
  const [showRecovery, setShowRecovery] = useState(false);

  // Once per visit while idle: prune old recovery data, then offer what remains.
  useEffect(() => {
    if (isRecording) return;
    void (async () => {
      await indexedDBService.deleteOldMeetings(7).catch(error => console.warn('Recovery cleanup failed:', error));
      await indexedDBService.deleteSavedMeetings(24).catch(error => console.warn('Recovery cleanup failed:', error));
      await checkForRecoverableTranscripts();
    })();
  }, [isRecording, checkForRecoverableTranscripts]);

  useEffect(() => {
    if (recoverableMeetings.length && !sessionStorage.getItem(RECOVERY_SHOWN)) {
      sessionStorage.setItem(RECOVERY_SHOWN, 'true');
      setShowRecovery(true);
    }
  }, [recoverableMeetings]);

  async function recover(meetingId: string) {
    try {
      const result = await recovery.recoverMeeting(meetingId);
      if (!result.success) return;
      toast.success('Meeting recovered', {
        description: result.audioRecoveryStatus?.status === 'success' ? 'Transcripts and audio recovered' : 'Transcripts recovered (no audio available)',
      });
      await refetchMeetings();
      if (result.meetingId) router.push(`/meeting-details?id=${result.meetingId}`);
    } catch (error) {
      toast.error('Failed to recover meeting', { description: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  return <>
    <TranscriptRecovery isOpen={showRecovery && !isRecording} recoverableMeetings={recoverableMeetings}
      onClose={() => {
        setShowRecovery(false);
        if (!recoverableMeetings.length) sessionStorage.removeItem(RECOVERY_SHOWN);
      }}
      onRecover={recover} onDelete={recovery.deleteRecoverableMeeting} onLoadPreview={recovery.loadMeetingTranscripts} />
    <Recorder />
  </>;
}
