import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { useConfig } from '@/contexts/ConfigContext';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import { recordingService } from '@/services/recordingService';
import { showRecordingNotification } from '@/lib/recordingNotification';
import { toast } from 'sonner';

/** Recording controls use native validation for the selected local or API provider. */
export function useRecordingStart(
  isRecording: boolean,
  setIsRecording: (value: boolean) => void,
  showModal?: (name: 'modelSelector', message?: string) => void
): { handleRecordingStart: () => Promise<void>; isAutoStarting: boolean } {
  const [isAutoStarting, setIsAutoStarting] = useState(false);
  const starting = useRef(false);
  const { clearTranscripts, setMeetingTitle } = useTranscripts();
  const { setIsMeetingActive } = useSidebar();
  const { selectedDevices } = useConfig();
  const { setStatus } = useRecordingState();

  const handleRecordingStart = useCallback(async () => {
    if (isRecording || starting.current) return;
    starting.current = true;
    try {
      const now = new Date();
      const parts = [now.getDate(), now.getMonth() + 1, now.getFullYear() % 100, now.getHours(), now.getMinutes(), now.getSeconds()];
      const title = 'Meeting ' + parts.map(value => String(value).padStart(2, '0')).join('_');
      setStatus(RecordingStatus.STARTING, 'Starting recording…');
      await recordingService.startRecordingWithDevices(selectedDevices?.micDevice || null, selectedDevices?.systemDevice || null, title);
      setMeetingTitle(title);
      clearTranscripts();
      setIsRecording(true);
      setIsMeetingActive(true);
      // Notification failure must not mark an active recording as stopped.
      void showRecordingNotification().catch(error => console.error('Cannot show recording notification:', error));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(RecordingStatus.ERROR, message);
      setIsRecording(false);
      if (/model.*(not|missing|download)|no.*model|API key|speech model/i.test(message)) {
        showModal?.('modelSelector', message);
      }
      throw error;
    } finally { starting.current = false; }
  }, [isRecording, selectedDevices, setMeetingTitle, clearTranscripts, setIsRecording, setIsMeetingActive, setStatus, showModal]);

  useEffect(() => {
    const startFromSidebar = async () => {
      if (isRecording || starting.current) return;
      setIsAutoStarting(true);
      try { await handleRecordingStart(); }
      catch (error) { toast.error('Cannot start recording.', { description: error instanceof Error ? error.message : String(error) }); }
      finally { setIsAutoStarting(false); }
    };
    if (sessionStorage.getItem('autoStartRecording') === 'true') {
      sessionStorage.removeItem('autoStartRecording');
      void startFromSidebar();
    }
    window.addEventListener('start-recording-from-sidebar', startFromSidebar);
    return () => window.removeEventListener('start-recording-from-sidebar', startFromSidebar);
  }, [isRecording, handleRecordingStart]);

  return { handleRecordingStart, isAutoStarting };
}
