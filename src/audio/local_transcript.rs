use tauri::{AppHandle, Manager, Runtime};

async fn meeting_audio_file<R: Runtime>(app: &AppHandle<R>, meeting_id: String) -> Result<std::path::PathBuf, String> {
    let state = app.state::<crate::state::AppState>();
    let folder: Option<String> = sqlx::query_scalar("SELECT folder_path FROM meetings WHERE id = ?")
        .bind(meeting_id).fetch_optional(state.db_manager.pool()).await
        .map_err(|e| e.to_string())?.flatten();
    let folder = folder.ok_or("This meeting has no saved audio folder.")?;
    super::retranscription::find_audio_file(std::path::Path::new(&folder)).map_err(|e| e.to_string())
}

/// Resolve only a saved meeting's audio and grant that single file to the player.
#[tauri::command]
pub async fn get_meeting_audio_path<R: Runtime>(app: AppHandle<R>, meeting_id: String) -> Result<String, String> {
    let path = meeting_audio_file(&app, meeting_id).await?;
    app.asset_protocol_scope().allow_file(&path).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Read the recording length from the file header so the UI can estimate processing time.
#[tauri::command]
pub async fn get_meeting_audio_duration<R: Runtime>(app: AppHandle<R>, meeting_id: String) -> Result<f64, String> {
    let path = meeting_audio_file(&app, meeting_id).await?;
    super::import::extract_duration_from_metadata(&path).map_err(|e| e.to_string())
}

/// Hardware facts the UI uses to estimate local transcription time.
#[tauri::command]
pub fn get_transcription_hardware() -> serde_json::Value {
    serde_json::json!({
        "cpu_cores": super::hardware_detector::HardwareProfile::detect().cpu_cores,
        "gpu_backend": crate::whisper_engine::WhisperCompiledBackend::current().as_str(),
    })
}

/// Transcribe a saved meeting locally. Keep the audio intact if inference fails.
#[tauri::command]
pub async fn finalize_local_transcript<R: Runtime>(
    app: AppHandle<R>,
    meeting_id: String,
    meeting_folder_path: String,
) -> Result<serde_json::Value, String> {
    let state = app.state::<crate::state::AppState>();
    let stored: Option<String> = sqlx::query_scalar("SELECT folder_path FROM meetings WHERE id = ?")
        .bind(&meeting_id).fetch_optional(state.db_manager.pool()).await
        .map_err(|error| error.to_string())?.flatten();
    let stored = stored.ok_or("The saved meeting has no recording folder.")?;
    let folder = std::path::Path::new(&meeting_folder_path)
        .canonicalize().map_err(|error| error.to_string())?;
    if folder != std::path::Path::new(&stored).canonicalize().map_err(|error| error.to_string())? {
        return Err("Recording folder does not match the saved meeting.".into());
    }
    let config = crate::api::api::api_get_transcript_config(app.clone(), app.state(), None)
        .await?.ok_or("Select a local speech model in Settings > Transcription.")?;
    if !matches!(config.provider.as_str(), "localWhisper" | "parakeet") {
        return Err("Select a local speech model in Settings > Transcription.".into());
    }
    let language = crate::get_language_preference_internal();
    let speakers = crate::speakers::get_speaker_settings(app.clone()).map(|s| s.enabled).unwrap_or(false);
    // Resolve here too so timing estimates are recorded against the model that actually ran.
    let swiss_german_ready = crate::whisper_engine::commands::whisper_model_downloaded(crate::config::SWISS_GERMAN_WHISPER_MODEL);
    let (provider, model) = crate::config::speech_model_for_language(
        Some(config.provider), Some(config.model), language.as_deref(), swiss_german_ready);
    let result = super::retranscription::start_retranscription(
        app.clone(), meeting_id, folder.to_string_lossy().into_owned(),
        language, model.clone(), provider,
    ).await.map_err(|error| error.to_string())?;
    Ok(serde_json::json!({
        "segments": result.segments_count, "status": "final",
        "duration_seconds": result.duration_seconds, "model": model, "speakers": speakers,
    }))
}
