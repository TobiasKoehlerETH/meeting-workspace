import { useState, useEffect } from 'react';
import { useRecordingState } from '@/contexts/RecordingStateContext';

/** Reuse the global backend subscription; the page does not need another poll. */
export function useRecordingStateSync(
  isRecording: boolean,
  setIsRecording: (value: boolean) => void,
  setIsMeetingActive: (value: boolean) => void,
) {
  const { isRecording: backendRecording } = useRecordingState();
  const [isRecordingDisabled, setIsRecordingDisabled] = useState(false);
  useEffect(() => {
    if (backendRecording !== isRecording) setIsRecording(backendRecording);
    if (backendRecording) setIsMeetingActive(true);
  }, [backendRecording, isRecording, setIsRecording, setIsMeetingActive]);
  return { isBackendRecording: backendRecording, isRecordingDisabled, setIsRecordingDisabled };
}
