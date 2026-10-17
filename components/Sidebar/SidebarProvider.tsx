'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';

export interface CurrentMeeting {
  id: string;
  title: string;
}

interface TranscriptSearchResult {
  id: string;
  title: string;
  matchContext: string;
  timestamp: string;
}

interface SidebarContextType {
  currentMeeting: CurrentMeeting | null;
  setCurrentMeeting: (meeting: CurrentMeeting | null) => void;
  isCollapsed: boolean;
  toggleCollapse: () => void;
  expandSidebar: () => void;
  meetings: CurrentMeeting[];
  setMeetings: (meetings: CurrentMeeting[]) => void;
  searchTranscripts: (query: string) => void;
  searchResults: TranscriptSearchResult[];
  isSearching: boolean;
  startSummaryPolling: (meetingId: string, processId: string, onUpdate: (result: any) => void) => void;
  stopSummaryPolling: (meetingId: string) => void;
  refetchMeetings: () => Promise<void>;
}

const SidebarContext = createContext<SidebarContextType | null>(null);

export const useSidebar = () => {
  const context = useContext(SidebarContext);
  if (!context) throw new Error('useSidebar must be used within a SidebarProvider');
  return context;
};

const HOME_MEETING = { id: 'intro-call', title: '+ New Call' };
const POLL_MS = 5000;
const MAX_POLLS = 200; // slightly longer than the backend's 15-minute summary timeout
const FINISHED = ['completed', 'error', 'failed', 'cancelled'];

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [currentMeeting, setCurrentMeeting] = useState<CurrentMeeting | null>(HOME_MEETING);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [meetings, setMeetings] = useState<CurrentMeeting[]>([]);
  const [searchResults, setSearchResults] = useState<TranscriptSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  const searchVersion = useRef(0);
  // Timers live in a ref: starting or stopping a poll must not re-render the app.
  const polls = useRef(new Map<string, ReturnType<typeof setInterval>>());

  const refetchMeetings = useCallback(async () => {
    try {
      const list = await invoke<CurrentMeeting[]>('api_get_meetings');
      setMeetings(list.map(({ id, title }) => ({ id, title })));
    } catch (error) {
      console.error('Error fetching meetings:', error);
      setMeetings([]);
    }
  }, []);

  useEffect(() => { void refetchMeetings(); }, [refetchMeetings]);
  useEffect(() => { if (pathname === '/') setCurrentMeeting(HOME_MEETING); }, [pathname]);

  const searchTranscripts = useCallback((query: string) => {
    clearTimeout(searchTimer.current);
    const version = ++searchVersion.current;
    const text = query.trim();
    setSearchResults([]);
    setIsSearching(Boolean(text));
    if (!text) return;

    // Invalidate immediately so a previous request cannot win during the debounce.
    searchTimer.current = setTimeout(async () => {
      try {
        const results = await invoke<TranscriptSearchResult[]>('api_search_transcripts', { query: text });
        if (version === searchVersion.current) setSearchResults(results);
      } catch (error) {
        if (version === searchVersion.current) console.error('Error searching transcripts:', error);
      } finally {
        if (version === searchVersion.current) setIsSearching(false);
      }
    }, 250);
  }, []);

  useEffect(() => () => {
    clearTimeout(searchTimer.current);
    searchVersion.current++;
  }, []);

  const stopSummaryPolling = useCallback((meetingId: string) => {
    clearInterval(polls.current.get(meetingId));
    polls.current.delete(meetingId);
  }, []);

  const startSummaryPolling = useCallback((meetingId: string, processId: string, onUpdate: (result: any) => void) => {
    stopSummaryPolling(meetingId);
    let count = 0;
    polls.current.set(meetingId, setInterval(async () => {
      if (++count >= MAX_POLLS) {
        stopSummaryPolling(meetingId);
        onUpdate({ status: 'error', error: 'Summary generation timed out after 15 minutes. Please try again or check your model configuration.' });
        return;
      }
      try {
        const result = await invoke<any>('api_get_summary', { meetingId });
        onUpdate(result);
        // 'idle' after the first poll means the process finished or disappeared.
        if (FINISHED.includes(result.status) || (result.status === 'idle' && count > 1)) stopSummaryPolling(meetingId);
      } catch (error) {
        stopSummaryPolling(meetingId);
        onUpdate({ status: 'error', error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }, POLL_MS));
    console.log(`Polling summary for meeting ${meetingId}, process ${processId}`);
  }, [stopSummaryPolling]);

  useEffect(() => () => polls.current.forEach(clearInterval), []);

  const value = useMemo(() => ({
    currentMeeting, setCurrentMeeting, isCollapsed, meetings, setMeetings,
    toggleCollapse: () => setIsCollapsed(previous => !previous), expandSidebar: () => setIsCollapsed(false),
    searchTranscripts, searchResults, isSearching, startSummaryPolling, stopSummaryPolling, refetchMeetings,
  }), [currentMeeting, isCollapsed, meetings, searchTranscripts, searchResults, isSearching, startSummaryPolling, stopSummaryPolling, refetchMeetings]);

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}
