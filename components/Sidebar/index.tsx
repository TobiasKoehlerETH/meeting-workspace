'use client';

import React, { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { File, Home, NotebookPen, PanelLeft, Pencil, SearchIcon, Settings, Trash2, Upload, X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { useSidebar, type CurrentMeeting } from './SidebarProvider';
import { ConfirmationModal } from '../ConfirmationModel/confirmation-modal';
import { useImportDialog } from '@/contexts/ImportDialogContext';
import { useConfig } from '@/contexts/ConfigContext';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { VisuallyHidden } from '@/components/ui/visually-hidden';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '../ui/input-group';
import type { SettingsTab } from '@/lib/utils';

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const SettingsPanel = dynamic(() => import('@/components/SettingsPanel').then(module => module.SettingsPanel), {
  loading: () => <p className="p-8 text-sm text-gray-500" role="status">Loading settings…</p>,
});

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const {
    currentMeeting, setCurrentMeeting, isCollapsed, toggleCollapse, expandSidebar,
    searchTranscripts, searchResults, isSearching, meetings, setMeetings,
  } = useSidebar();
  const { openImportDialog } = useImportDialog();
  const { betaFeatures } = useConfig();
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [listOpen, setListOpen] = useState(true);
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<CurrentMeeting | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  // The tray and other pages open Settings through this global (see openSettings in lib/utils).
  useEffect(() => {
    const target = window as Window & { openSettings?: (tab?: SettingsTab) => void };
    target.openSettings = tab => setSettingsTab(tab ?? 'general');
    return () => { delete target.openSettings; };
  }, []);

  const searchById = useMemo(() => new Map(searchResults.map(result => [result.id, result])), [searchResults]);

  // A meeting matches by title or by a transcript search hit.
  const visibleMeetings = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return meetings;
    return meetings.filter(meeting => searchById.has(meeting.id) || meeting.title.toLowerCase().includes(text));
  }, [meetings, query, searchById]);

  function search(value: string) {
    setQuery(value);
    setListOpen(true);
    void searchTranscripts(value);
  }

  async function deleteMeeting(meetingId: string) {
    setDeleting(null);
    try {
      await invoke('api_delete_meeting', { meetingId });
      setMeetings(meetings.filter(meeting => meeting.id !== meetingId));
      toast.success('Meeting deleted');
      if (currentMeeting?.id === meetingId) router.push('/');
    } catch (error) {
      toast.error('Failed to delete meeting', { description: errorText(error) });
    }
  }

  async function rename() {
    if (!renaming) return;
    const title = renaming.title.trim();
    if (!title) { toast.error('Meeting title cannot be empty'); return; }
    try {
      await invoke('api_save_meeting_title', { meetingId: renaming.id, title });
      setMeetings(meetings.map(meeting => meeting.id === renaming.id ? { ...meeting, title } : meeting));
      if (currentMeeting?.id === renaming.id) setCurrentMeeting({ id: renaming.id, title });
      setRenaming(null);
    } catch (error) {
      toast.error('Failed to rename meeting', { description: errorText(error) });
    }
  }

  const meetingRow = (meeting: CurrentMeeting) => {
    const active = pathname?.includes('/meeting-details') && currentMeeting?.id === meeting.id;
    const snippet = query.trim() && searchById.get(meeting.id)?.matchContext;
    return <li key={meeting.id} className="meeting-row">
      <div className={`group flex min-w-0 items-center rounded-md ${active ? 'bg-gray-100' : 'hover:bg-gray-50'}`}>
        <button type="button" aria-current={active ? 'page' : undefined} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm"
          onClick={() => { setCurrentMeeting(meeting); router.push('/meeting-details?id=' + encodeURIComponent(meeting.id)); }}>
          <File className="h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate" title={meeting.title}>{meeting.title}</span>
        </button>
        <div className="flex shrink-0 gap-1 pr-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button type="button" aria-label="Edit meeting title" title={'Rename ' + meeting.title} onClick={() => setRenaming(meeting)} className="rounded p-1 hover:bg-gray-100"><Pencil className="h-4 w-4" aria-hidden="true" /></button>
          <button type="button" aria-label="Delete meeting" title={'Delete ' + meeting.title} onClick={() => setDeleting(meeting.id)} className="rounded p-1 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
        </div>
      </div>
      {snippet && <p className="ml-6 px-2 pb-2 text-xs text-gray-500 line-clamp-2">{snippet}</p>}
    </li>;
  };

  const label = (text: string) => !isCollapsed && <span>{text}</span>;

  return <>
    <aside id="workspace-sidebar" aria-label="Workspace navigation" className={`ap-sidebar flex h-screen shrink-0 flex-col border-r bg-white ${isCollapsed ? 'w-16' : 'w-64'}`}>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-gray-200 px-3">
        <button type="button" onClick={toggleCollapse} aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!isCollapsed} aria-controls="sidebar-content" title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} className="ap-nav-icon shrink-0">
          <PanelLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        {!isCollapsed && <span className="text-sm font-semibold leading-tight">Meeting Workspace</span>}
      </header>

      <nav aria-label="Main navigation" className="shrink-0 space-y-1 p-2">
        <button type="button" aria-label="Home" title="Home" aria-current={pathname === '/' ? 'page' : undefined} onClick={() => router.push('/')} className={`ap-nav-item ${pathname === '/' ? 'bg-gray-100' : ''}`}>
          <Home className="h-5 w-5 shrink-0" aria-hidden="true" />{label('Home')}
        </button>
        {betaFeatures.importAndRetranscribe && <button type="button" aria-label="Import audio" title="Import audio" onClick={() => openImportDialog()} className="ap-nav-item">
          <Upload className="h-5 w-5 shrink-0" aria-hidden="true" />{label('Import audio')}
        </button>}
      </nav>

      <div id="sidebar-content" className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-2">
        {isCollapsed
          ? <button type="button" aria-label="Meeting notes" title="Meeting notes" onClick={() => { expandSidebar(); setListOpen(true); }} className="ap-nav-item"><NotebookPen className="h-5 w-5" aria-hidden="true" /></button>
          : <details open={listOpen} onToggle={event => setListOpen(event.currentTarget.open)}>
            <summary className="ap-nav-item cursor-pointer list-none" aria-label="Meeting notes"><NotebookPen className="h-5 w-5 shrink-0" aria-hidden="true" /><span>Meeting notes</span></summary>
            <div className="py-2">
              <InputGroup>
                <InputGroupInput aria-label="Search meetings" placeholder="Search meetings" value={query} onChange={event => search(event.target.value)} />
                <InputGroupAddon><SearchIcon className="h-4 w-4" /></InputGroupAddon>
                {query && <InputGroupAddon align="inline-end"><InputGroupButton type="button" aria-label="Clear search" onClick={() => search('')}><X /></InputGroupButton></InputGroupAddon>}
              </InputGroup>
            </div>
            <ul id="meeting-list" className="space-y-1 pb-4">
              {isSearching && <li className="px-2 text-xs text-gray-500" role="status">Searching...</li>}
              {visibleMeetings.map(meetingRow)}
              {meetings.length === 0 && <li className="px-2 py-3 text-sm text-gray-500">No meetings yet.</li>}
              {meetings.length > 0 && !isSearching && query.trim() && visibleMeetings.length === 0 && <li className="px-2 py-3 text-sm text-gray-500" role="status">No matches.</li>}
            </ul>
          </details>}
      </div>

      <footer className="shrink-0 border-t border-gray-200 p-2">
        <button type="button" aria-label="Settings" title="Settings" aria-haspopup="dialog" onClick={() => setSettingsTab('general')} className="ap-nav-item">
          <Settings className="h-5 w-5 shrink-0" aria-hidden="true" />{label('Settings')}
        </button>
      </footer>
    </aside>

    <Dialog open={settingsTab !== null} onOpenChange={open => { if (!open) setSettingsTab(null); }}>
      <DialogContent aria-describedby={undefined} className="ap-app block h-[min(90vh,800px)] w-[calc(100vw-2rem)] max-w-[960px] overflow-hidden p-0">
        <VisuallyHidden><DialogTitle>Settings</DialogTitle></VisuallyHidden>
        {settingsTab && <SettingsPanel initialTab={settingsTab} />}
      </DialogContent>
    </Dialog>

    <ConfirmationModal isOpen={deleting !== null} text="Delete this meeting and its saved data. This cannot be undone."
      onConfirm={() => deleting && void deleteMeeting(deleting)} onCancel={() => setDeleting(null)} />

    <Dialog open={renaming !== null} onOpenChange={open => { if (!open) setRenaming(null); }}>
      <DialogContent aria-describedby={undefined} className="sm:max-w-[425px]">
        <DialogTitle>Rename meeting</DialogTitle>
        <form onSubmit={event => { event.preventDefault(); void rename(); }}>
          <label htmlFor="meeting-title" className="mb-2 block text-sm font-medium text-gray-700">Meeting title</label>
          <input id="meeting-title" type="text" autoFocus value={renaming?.title ?? ''}
            onChange={event => setRenaming(previous => previous && { ...previous, title: event.target.value })}
            className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-gray-900" />
          <DialogFooter className="mt-6">
            <button type="button" onClick={() => setRenaming(null)} className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">Cancel</button>
            <button type="submit" className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">Save</button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
