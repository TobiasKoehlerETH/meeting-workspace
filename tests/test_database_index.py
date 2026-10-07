from pathlib import Path
import sqlite3
import unittest


class TranscriptIndexTests(unittest.TestCase):
    def test_migrations_index_pagination_count_and_delete(self):
        with sqlite3.connect(':memory:') as database:
            for migration in sorted((Path(__file__).resolve().parents[1] / 'src-tauri/migrations').glob('*.sql')):
                database.executescript(migration.read_text(encoding='utf-8'))
            database.executemany(
                'INSERT INTO meetings (id,title,created_at,updated_at) VALUES (?,?,?,?)',
                [(name, name, '2026-10-05', '2026-10-05') for name in ['selected', 'other']],
            )
            database.executemany(
                'INSERT INTO transcripts (id,meeting_id,transcript,timestamp,audio_start_time) VALUES (?,?,?,?,?)',
                [(str(i), 'selected' if i % 2 == 0 else 'other', 'Text', '2026-10-05', i) for i in reversed(range(1000))],
            )
            query = 'SELECT id FROM transcripts WHERE meeting_id = ? ORDER BY audio_start_time ASC LIMIT 10 OFFSET 10'
            self.assertEqual(database.execute(query, ('selected',)).fetchall(), [(str(i),) for i in range(20, 40, 2)])
            plan = str(database.execute('EXPLAIN QUERY PLAN ' + query, ('selected',)).fetchall())
            self.assertIn('idx_transcripts_meeting_timeline', plan)
            self.assertNotIn('TEMP B-TREE', plan)
            self.assertEqual(database.execute('SELECT COUNT(*) FROM transcripts WHERE meeting_id = ?', ('selected',)).fetchone()[0], 500)
            database.execute('DELETE FROM meetings WHERE id = ?', ('selected',))
            self.assertEqual(database.execute('SELECT COUNT(*) FROM transcripts').fetchone()[0], 500)


if __name__ == '__main__':
    unittest.main()
