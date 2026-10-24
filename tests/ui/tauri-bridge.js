// This bridge is injected only by the local UI test server, never by the app build.
(() => {
  const scenario = new URLSearchParams(location.search).get('qa') || 'main';
  const callbacks = new Map();
  const listeners = new Map();
  const stores = new Map();
  let counter = 1;
  const root = 'C:\\UI-Test-Workspace';
  const now = '2026-10-05T09:00:00Z';
  const meetings = scenario === 'empty' ? [] : [
    { id: 'qa-planning', title: 'QA Planning Meeting', created_at: now, updated_at: now, folder_path: root + '\\recordings\\qa-planning' },
    { id: 'qa-review', title: 'QA Design Review', created_at: now, updated_at: now, folder_path: root + '\\recordings\\qa-review' },
  ];
  const transcripts = [
    { id: 'qa-segment-1', speaker: 'Speaker 1', text: 'We will review the interface and confirm the next steps.', timestamp: '00:00', audio_start_time: 0, audio_end_time: 12, confidence: 0.94 },
    { id: 'qa-segment-2', speaker: 'Speaker 2', text: 'The team agreed to improve navigation and test every control.', timestamp: '00:12', audio_start_time: 12, audio_end_time: 24, confidence: 0.96 },
  ];
  let modelConfig = { provider: 'builtin-ai', model: 'qwen3.5:4b', whisperModel: 'base', apiKey: 'qa-placeholder-key', ollamaEndpoint: null };
  let transcriptConfig = { provider: 'localWhisper', model: 'large-v3-turbo-q5_0', apiKey: 'qa-placeholder-key' };
  let preferences = { save_folder: root + '\\recordings', auto_save: true, file_format: 'mp4', preferred_mic_device: null, preferred_system_device: null };
  let recording = false;
  let paused = false;
  let meetingName = null;
  const monitor = { name: 'QA', scaleFactor: 1, position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 }, workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } } };
  const launchPreferences = { start_minimized: false };
  let speakerSettings = { enabled: true, speaker_count: 0 };
  const notificationSettings = { recording_notifications: true, time_based_reminders: false, meeting_reminders: false, respect_do_not_disturb: true, notification_sound: false, system_permission_granted: true, consent_given: true, manual_dnd_mode: false, notification_preferences: { show_recording_started: true, show_recording_stopped: true, show_recording_paused: true, show_recording_resumed: true, show_transcription_complete: true, show_meeting_reminders: false, show_system_errors: true, meeting_reminder_minutes: [15] } };
  const available = scenario !== 'no-models';
  const models = {
    parakeet: [{ name: 'parakeet-tdt-0.6b-v3-int8', path: root + '\\models\\parakeet', size_mb: 670, accuracy: 'High', speed: 'Ultra Fast', quantization: 'Int8', status: available ? 'Available' : 'Missing', description: 'Test transcription model' }],
    whisper: [['large-v3-turbo-q5_0', 547], ['large-v3', 2951], ['small', 466], ['base', 142]].map(([name, size_mb], index) =>
      ({ name, path: root + '\\models\\' + name + '.bin', size_mb, status: available && index !== 1 ? 'Available' : 'Missing' })),
    summary: [{ name: 'qwen3-0.6b', display_name: 'Qwen3 0.6B', path: root + '\\models\\qwen.gguf', size_mb: 400, context_size: 8192, gguf_file: 'qwen.gguf', description: 'Test local summary model', status: { type: available ? 'available' : 'not_downloaded' } }],
  };
  const log = [];
  const unknown = [];
  window.__QA__ = { scenario, log, unknown, meetings, models, get recording() { return recording; } };
  window.__TAURI_OS_PLUGIN_INTERNALS__ = { platform: 'windows', os_type: 'windows', family: 'windows', arch: 'x86_64', version: '11', locale: 'en-US', eol: '\r\n' };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener(event, id) { listeners.delete(id); } };
  function emit(event, payload) {
    for (const [id, listener] of listeners) if (listener.event === event) callbacks.get(listener.handler)?.({ event, id, payload });
  }
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    transformCallback(fn) { const id = counter++; callbacks.set(id, fn); return id; },
    unregisterCallback(id) { callbacks.delete(id); },
    convertFileSrc() { return '/__qa/audio.wav'; },
    async invoke(command, args = {}) {
      log.push({ command, args, time: Date.now() });
      document.documentElement.dataset.qaCalls = JSON.stringify(log.slice(-40));
      if (command === 'plugin:event|listen') { const id = counter++; listeners.set(id, args); return id; }
      if (command === 'plugin:event|unlisten') { listeners.delete(args.eventId); return; }
      if (command === 'plugin:event|emit' || command === 'plugin:event|emit_to') { emit(args.event, args.payload); return; }
      if (command.startsWith('plugin:store|')) {
        const method = command.split('|')[1];
        if (method === 'load') { const rid = counter++; stores.set(rid, new Map(Object.entries(args.options?.defaults || {}))); return rid; }
        const store = stores.get(args.rid) || new Map();
        if (method === 'get') return [store.get(args.key), store.has(args.key)];
        if (method === 'set') { store.set(args.key, args.value); return; }
        if (method === 'has') return store.has(args.key);
        if (method === 'entries') return [...store];
        if (method === 'keys') return [...store.keys()];
        if (method === 'values') return [...store.values()];
        if (method === 'length') return store.size;
        if (method === 'delete') return store.delete(args.key);
        return null;
      }
      if (command.startsWith('plugin:path|')) return args.paths?.join('\\') || root + (args.path ? '\\' + args.path : '');
      if (command === 'plugin:app|version') return '0.4.0';
      if (command === 'plugin:app|name') return 'Meeting Workspace';
      if (command === 'plugin:window|inner_size' || command === 'plugin:window|outer_size') return { width: innerWidth, height: innerHeight };
      if (command === 'plugin:window|outer_position') return { x: 0, y: 0 };
      if (command === 'plugin:window|current_monitor' || command === 'plugin:window|primary_monitor') return monitor;
      if (command === 'plugin:window|available_monitors') return [monitor];
      if (command === 'plugin:window|is_maximized') return false;
      if (command.startsWith('plugin:window|') || command.startsWith('plugin:webview|')) return command.endsWith('get_all_windows') ? ['main'] : null;
      if (command.startsWith('plugin:notification|')) return true;
      if (command === 'get_onboarding_status') return scenario === 'onboarding' ? null : { completed: true, current_step: 3, permissions: { microphone: 'authorized', systemAudio: 'authorized' }, model_status: { parakeet: 'downloaded', summary: 'downloaded', selected_summary_model: 'qwen3-0.6b' } };
      if (command === 'check_first_launch') return false;
      if (command === 'prepare_recording') return null;
      if (command === 'get_speaker_settings') return speakerSettings;
      if (command === 'set_speaker_settings') { speakerSettings = args.settings; return null; }
      if (command === 'list_meeting_speakers') return [...new Set(transcripts.map(t => t.speaker).filter(Boolean))];
      if (command === 'rename_meeting_speaker') { transcripts.forEach(t => { if (t.speaker === args.speaker) t.speaker = args.name; }); return null; }
      if (command === 'get_start_minimized') return launchPreferences.start_minimized;
      if (command === 'set_start_minimized') { launchPreferences.start_minimized = args.enabled; return null; }
      if (command === 'finalize_local_transcript') {
        document.documentElement.dataset.qaFinalPass = args.meetingId;
        for (const [progress_percentage, message] of [[5, 'Decoding audio…'], [20, 'Detecting speakers locally…'], [55, 'Transcribing segment 2 of 4…'], [90, 'Saving transcript…']]) {
          emit('retranscription-progress', { meeting_id: args.meetingId, progress_percentage, message });
          await new Promise(resolve => setTimeout(resolve, 400));
        }
        return { status: 'final', segments: 2, duration_seconds: 1920, model: transcriptConfig.model, speakers: speakerSettings.enabled };
      }
      if (command === 'get_meeting_audio_duration') return 1920;
      if (command === 'get_transcription_hardware') return { cpu_cores: 8, gpu_backend: 'Cpu' };
      if (command === 'get_meeting_audio_path') return root + '\\recordings\\' + args.meetingId + '\\recording.wav';
      if (['save_onboarding_status_cmd', 'complete_onboarding', 'initialize_fresh_database', 'import_and_initialize_database'].includes(command)) return null;
      if (command === 'api_get_model_config') return modelConfig;
      if (command === 'api_save_model_config') { modelConfig = { ...modelConfig, ...args }; return { status: 'success' }; }
      if (command === 'api_get_transcript_config') return transcriptConfig;
      if (command === 'api_save_transcript_config') { transcriptConfig = { ...transcriptConfig, ...args }; return { status: 'success' }; }
      if (command === 'api_save_transcript') {
        const id = 'qa-saved-recording';
        if (!meetings.some(meeting => meeting.id === id)) meetings.push({ id, title: args.meetingName || meetingName, created_at: now, updated_at: now, folder_path: args.folderPath || root + '\\recordings\\qa-new' });
        return { meeting_id: id, status: 'success' };
      }
      if (command === 'get_recording_preferences') return preferences;
      if (command === 'set_recording_preferences') { preferences = args.preferences; return null; }
      if (command === 'get_notification_settings') return notificationSettings;
      if (command === 'set_notification_settings') { Object.assign(notificationSettings, args.settings); return null; }
      if (command === 'api_get_transcript_api_key') return transcriptConfig.apiKey || 'qa-placeholder-key';
      if (command === 'get_openrouter_transcription_models') return [{ id: 'openai/whisper-large-v3-turbo', name: 'Whisper Large V3 Turbo · Fast, low cost' }, { id: 'openai/gpt-4o-mini-transcribe', name: 'GPT-4o Mini Transcribe' }];
      if (command === 'api_get_custom_openai_config' || command === 'api_get_api_key') return null;
      if (command === 'api_test_custom_openai_connection') return { status: 'success', message: 'Test connection is available', http_status: 200 };
      if (command === 'get_ollama_models') return [{ name: 'llama3.2:latest', id: 'llama3.2:latest', size: '2 GB', modified: now }];
      if (command === 'get_openai_models' || command === 'get_anthropic_models' || command === 'get_groq_models' || command === 'get_openrouter_models') return [{ id: 'test-model', name: 'Test model' }];
      if (command === 'get_audio_devices') return [{ name: 'QA Microphone', device_type: 'Input', is_default: true }, { name: 'QA System Audio', device_type: 'Output', is_default: true }];
      if (command === 'get_recording_state') return { is_recording: recording, is_paused: paused, is_active: recording && !paused, recording_duration: recording ? 12 : null, active_duration: recording ? 12 : null };
      if (command === 'is_recording') return recording;
      if (command === 'is_recording_paused') return paused;
      if (command === 'get_recording_meeting_name') return meetingName;
      if (command === 'start_recording_with_devices_and_meeting' || command === 'start_recording') {
        if (scenario === 'slow-start') await new Promise(resolve => setTimeout(resolve, 3000));
        if ('mic_device_name' in args || 'meeting_name' in args) throw new Error('Recording command expects camelCase argument keys.');
        recording = true; paused = false; meetingName = args.meetingName || 'QA Recording';
        setTimeout(() => emit('recording-started', null), 20); return null;
      }
      if (command === 'pause_recording') { paused = true; emit('recording-paused', null); return null; }
      if (command === 'resume_recording') { paused = false; emit('recording-resumed', null); return null; }
      if (command === 'stop_recording') { recording = false; paused = false; setTimeout(() => { emit('transcription-complete', {}); emit('recording-stopped', { message: 'Test recording stopped', folder_path: root + '\\recordings\\qa-new', meeting_name: meetingName }); }, 30); return null; }
      if (command === 'get_transcription_status') return { chunks_in_queue: 0, is_processing: false, last_activity_ms: 10000 };
      if (command === 'get_transcript_history') return [];
      if (command === 'poll_audio_device_events') return [];
      if (command === 'get_reconnection_status') return { is_reconnecting: false, device_name: null };
      if (command === 'get_active_audio_output') return { name: 'QA Speakers', is_bluetooth: false };
      if (command === 'api_get_meetings') return meetings;
      if (command === 'api_search_transcripts') return meetings.filter(m => m.title.toLowerCase().includes((args.query || '').toLowerCase())).map(m => ({ ...m, match_context: 'QA transcript match', matchContext: 'QA transcript match', timestamp: now }));
      if (command === 'api_get_meeting' || command === 'api_get_meeting_metadata') { const meeting = meetings.find(m => m.id === args.meetingId) || meetings[0]; return { ...meeting, total_transcripts: transcripts.length, total_count: transcripts.length, has_audio: true, recording_path: root + '\\qa.wav', audio_file_path: root + '\\qa.wav', transcripts }; }
      if (command === 'api_get_meeting_transcripts') return { transcripts, total_count: transcripts.length, has_more: false, limit: 100, offset: 0 };
      if (command === 'select_and_validate_audio_command' || command === 'validate_audio_file_command') return { path: root + '\\qa-audio.wav', filename: 'qa-audio.wav', duration_seconds: 24, sample_rate: 16000, channels: 1, file_size: 768000, format: 'wav' };
      if (command === 'start_import_audio_command') { setTimeout(() => emit('import-progress', { stage: 'transcribing', progress: 30, percentage: 30, message: 'Transcribing test audio', current: 1, total: 3 }), 60); return null; }
      if (command === 'cancel_import_command' || command === 'cancel_retranscription_command') return null;
      if (command === 'api_save_meeting_title') { const meeting = meetings.find(m => m.id === args.meetingId); if (meeting) meeting.title = args.title; return null; }
      if (command === 'api_delete_meeting') { const index = meetings.findIndex(m => m.id === args.meetingId); if (index >= 0) meetings.splice(index, 1); return null; }
      if (command === 'api_get_summary') return { status: 'completed', data: { markdown: '# QA meeting\n\n- Review the interface.\n- Verify the controls.', summary_json: [] } };
      if (command === 'api_list_templates') return [{ id: 'standard_meeting', name: 'Standard Meeting', description: 'General meeting summary', category: 'general' }];
      if (command.includes('summary_language')) return 'en';
      if (command === 'builtin_ai_get_models_directory') return root + '\\models';
      if (command === 'builtin_ai_list_models') return models.summary;
      if (command === 'builtin_ai_get_recommended_model') return 'qwen3-0.6b';
      if (command === 'builtin_ai_get_available_summary_model') return available ? 'qwen3-0.6b' : null;
      if (command === 'builtin_ai_get_model_info') return models.summary.find(m => m.name === args.modelName) || null;
      if (command === 'builtin_ai_is_model_ready') return available;
      if (command.endsWith('_get_available_models')) return command.startsWith('whisper') ? models.whisper : models.parakeet;
      if (command.endsWith('_has_available_models') || command.endsWith('_validate_model_ready')) return available;
      if (command.endsWith('_get_current_model')) return available ? command.startsWith('whisper') ? 'base' : 'parakeet-tdt-0.6b-v3-int8' : null;
      if (command.endsWith('_is_model_loaded')) return available;
      if (command.includes('_directory') || command.endsWith('_folder_path')) return root + '\\' + (command.includes('recording') ? 'recordings' : command.includes('database') ? 'database' : 'models');
      if (command.startsWith('open_') || command.startsWith('set_') || command.endsWith('_init') || command.includes('audio_level_monitoring') || command.startsWith('whisper_') || command.startsWith('parakeet_') || command.startsWith('builtin_ai_') || command.startsWith('api_save_')) return null;
      if (command === 'is_console_visible' || command === 'toggle_console') return false;
      if (command === 'test_backend_connection') return true;
      if (command === 'has_audio_checkpoints') return false;
      unknown.push(command);
      document.documentElement.dataset.qaUnknown = JSON.stringify(unknown);
      throw new Error('UI test fixture has no response for: ' + command);
    },
  };
})();
