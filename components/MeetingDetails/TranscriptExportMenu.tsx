'use client';

import { invoke } from '@tauri-apps/api/core';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const FORMATS = [['md', 'Markdown'], ['txt', 'Text'], ['docx', 'Word']] as const;

/** Saves the full transcript (all segments, speaker names, timestamps) in a chosen format. */
export function TranscriptExportMenu({ meetingId, disabled }: { meetingId: string; disabled?: boolean }) {
  async function save(format: (typeof FORMATS)[number][0]) {
    try {
      const path = await invoke<string | null>('export_meeting_transcript', { meetingId, format });
      if (path) toast.success('Transcript saved', { description: path });
    } catch (error) {
      toast.error('Could not export the transcript', { description: String(error) });
    }
  }

  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="outline" size="sm" disabled={disabled} aria-label="Export transcript" title="Export transcript">
        <Download size={16} />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      {FORMATS.map(([format, label]) =>
        <DropdownMenuItem key={format} onSelect={() => void save(format)}>{label}</DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}
