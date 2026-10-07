const assert = require('node:assert/strict');
const { test } = require('node:test');
const { IDBFactory } = require('fake-indexeddb');
const load = require('./load-typescript.cjs');

test('recovery commits transcripts and metadata together and preserves sequence ordering', async () => {
  const { indexedDBService: db } = load('services/indexedDBService.ts', {}, { indexedDB: new IDBFactory() });
  await Promise.all([db.init(), db.init()]);
  const meetingId = 'test-meeting';
  await db.saveMeetingMetadata({ meetingId, title: 'Test', startTime: 0, lastUpdated: 0, transcriptCount: 0, savedToSQLite: false });
  await Promise.all([3, 0, 2, 1].map(sequence_id => db.saveTranscript(meetingId, {
    sequence_id, text: `Text ${sequence_id}`, timestamp: '', confidence: 0.8, audio_start_time: sequence_id,
  })));
  assert.deepEqual((await db.getTranscripts(meetingId)).map(t => t.sequenceId), [0, 1, 2, 3]);
  assert.equal((await db.getMeetingMetadata(meetingId)).transcriptCount, 4);
  assert.equal(await db.getTranscriptCount(meetingId), 4);
  await db.markMeetingSaved(meetingId);
  assert.equal((await db.getMeetingMetadata(meetingId)).savedToSQLite, true);
});
