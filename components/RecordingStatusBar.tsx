'use client';

import { motion } from 'framer-motion';
import { useRecordingClock } from '@/contexts/RecordingStateContext';

interface RecordingStatusBarProps {
  isPaused?: boolean;
}

export const RecordingStatusBar: React.FC<RecordingStatusBarProps> = ({ isPaused = false }) => {
  // Get recording duration from backend-synced context (in seconds)
  const { activeDuration } = useRecordingClock();
  const displaySeconds = Math.floor(activeDuration ?? 0);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
      className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg mb-2"
    >
      <div className={`w-2 h-2 rounded-full ${isPaused ? 'bg-orange-500' : 'bg-red-500 animate-pulse'}`} />
      <span className={`text-sm ${isPaused ? 'text-orange-700' : 'text-gray-700'}`}>
        {isPaused ? 'Paused' : 'Recording'} • {formatDuration(displaySeconds)}
      </span>
    </motion.div>
  );
};
