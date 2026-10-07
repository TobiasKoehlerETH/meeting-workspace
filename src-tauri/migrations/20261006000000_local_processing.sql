-- Retire remote/live processing without removing saved credentials.
INSERT INTO transcript_settings (id, provider, model)
VALUES ('1', 'localWhisper', 'large-v3')
ON CONFLICT(id) DO UPDATE SET provider = 'localWhisper', model = 'large-v3';

INSERT INTO settings (id, provider, model, whisperModel)
VALUES ('1', 'builtin-ai', 'qwen3.5:4b', 'large-v3')
ON CONFLICT(id) DO UPDATE SET provider = 'builtin-ai', model = 'qwen3.5:4b', whisperModel = 'large-v3';
