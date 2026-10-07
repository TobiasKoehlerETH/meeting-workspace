-- Supports meeting lookup, transcript counts, chronological pagination, and cascade deletion.
CREATE INDEX IF NOT EXISTS idx_transcripts_meeting_timeline
ON transcripts(meeting_id, audio_start_time);
