'use client';

import { motion } from 'framer-motion';
import { FileQuestion, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmptyStateSummaryProps {
  onGenerate: () => void;
  hasModel: boolean;
  isGenerating?: boolean;
}

export function EmptyStateSummary({ onGenerate, hasModel, isGenerating = false }: EmptyStateSummaryProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex flex-col items-center justify-center h-full p-8 text-center"
    >
      <FileQuestion className="w-16 h-16 text-gray-300 mb-4" />
      <Button onClick={onGenerate} disabled={!hasModel || isGenerating} className="gap-2">
        <Sparkles className="w-4 h-4" />
        {isGenerating ? 'Generating...' : 'Generate summary'}
      </Button>

      {!hasModel && (
        <p className="text-xs text-amber-600 mt-3">
          Select a model in Settings.
        </p>
      )}
    </motion.div>
  );
}
