use super::worker::TranscriptUpdate;
use crate::audio::AudioChunk;
use serde::Deserialize;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

pub const MODEL: &str = "nemotron-3.5-streaming-int8";
static TWO_STAGE_CAPTURE: AtomicBool = AtomicBool::new(false);
static PREPARED: Mutex<Option<StreamingProcess>> = Mutex::const_new(None);

pub fn is_two_stage() -> bool { TWO_STAGE_CAPTURE.load(Ordering::SeqCst) }
pub fn set_two_stage(enabled: bool) { TWO_STAGE_CAPTURE.store(enabled, Ordering::SeqCst); }

#[derive(Deserialize)]
struct LiveResult { text: String, #[serde(rename = "final")] final_segment: bool }

struct StreamingProcess {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    language: String,
}

fn model_directory<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|error| error.to_string())?.join("models/nemotron-streaming"))
}

const MODEL_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11.tar.bz2";
const MODEL_FILES: &[&str] = &["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"];

#[tauri::command]
pub async fn get_local_pipeline_status<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, String> {
    let directory = model_directory(&app)?;
    let nemotron = MODEL_FILES.iter().all(|file| directory.join(file).is_file());
    crate::parakeet_engine::commands::parakeet_init().await?;
    let parakeet = crate::parakeet_engine::commands::parakeet_get_available_models().await?.iter()
        .any(|model| model.name == crate::config::DEFAULT_PARAKEET_MODEL && matches!(model.status, crate::parakeet_engine::ModelStatus::Available));
    Ok(serde_json::json!({"nemotron":nemotron,"parakeet":parakeet}))
}

#[tauri::command]
pub async fn download_nemotron_model<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let directory = model_directory(&app)?;
    if MODEL_FILES.iter().all(|file| directory.join(file).is_file()) { return Ok(()); }
    tokio::task::spawn_blocking(move || {
        use std::io::Write;
        let staging = directory.with_file_name(format!("nemotron-download-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
        let archive_path = staging.join("model.tar.bz2");
        let mut response = reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(1200)).build()
            .map_err(|error| error.to_string())?.get(MODEL_URL).send().map_err(|error| error.to_string())?
            .error_for_status().map_err(|error| error.to_string())?;
        let mut archive_file = std::fs::File::create(&archive_path).map_err(|error| error.to_string())?;
        std::io::copy(&mut response, &mut archive_file).map_err(|error| error.to_string())?;
        archive_file.flush().map_err(|error| error.to_string())?;
        let compressed = std::fs::File::open(&archive_path).map_err(|error| error.to_string())?;
        let mut archive = tar::Archive::new(bzip2::read::BzDecoder::new(compressed));
        for item in archive.entries().map_err(|error| error.to_string())? {
            let mut entry = item.map_err(|error| error.to_string())?;
            if !entry.header().entry_type().is_file() { continue; }
            let name = entry.path().map_err(|error| error.to_string())?.file_name().and_then(|name| name.to_str()).unwrap_or("").to_owned();
            if MODEL_FILES.contains(&name.as_str()) { entry.unpack(staging.join(&name)).map_err(|error| error.to_string())?; }
        }
        if !MODEL_FILES.iter().all(|file| staging.join(file).is_file()) { return Err("Nemotron download is incomplete.".into()); }
        std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        for file in MODEL_FILES { std::fs::rename(staging.join(file), directory.join(file)).map_err(|error| error.to_string())?; }
        let _ = std::fs::remove_file(archive_path);
        let _ = std::fs::remove_dir(staging);
        Ok::<(), String>(())
    }).await.map_err(|error| error.to_string())?
}

fn helper_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let directory = exe.parent().ok_or("Cannot locate the app directory.")?;
    for path in [directory.join("nemotron-helper.exe"), directory.join("nemotron-helper-x86_64-pc-windows-msvc.exe"), PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries/nemotron-helper-x86_64-pc-windows-msvc.exe")] {
        if path.is_file() { return Ok(path); }
    }
    Err("Nemotron runtime is missing. Install the complete app package.".into())
}

pub fn validate_local_files<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let directory = model_directory(app)?;
    if !MODEL_FILES.iter().all(|file| directory.join(file).is_file()) {
        return Err("Download Nemotron in Settings > Transcription before recording.".into());
    }
    helper_path()?;
    Ok(())
}

pub async fn prepare<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let directory = model_directory(app)?;
    for file in ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"] {
        if !directory.join(file).is_file() { return Err("Download Nemotron in Settings > Transcription before recording.".into()); }
    }
    let language = crate::get_language_preference_internal().unwrap_or_else(|| "auto".into());
    let language = if language == "auto-translate" { "auto".into() } else { language };
    let mut prepared = PREPARED.lock().await;
    if let Some(process) = prepared.as_mut() {
        if process.language == language && process.child.try_wait().map_err(|error| error.to_string())?.is_none() { return Ok(()); }
    }
    *prepared = None;
    let mut command = Command::new(helper_path()?);
    command.arg(&directory).arg(&language).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
    #[cfg(windows)] command.creation_flags(0x08000000);
    let mut child = command.spawn().map_err(|error| format!("Cannot start Nemotron: {}", error))?;
    let input = child.stdin.take().ok_or("Nemotron input is unavailable.")?;
    let mut output = BufReader::new(child.stdout.take().ok_or("Nemotron output is unavailable.")?);
    let mut ready = String::new();
    tokio::time::timeout(std::time::Duration::from_secs(90), output.read_line(&mut ready)).await
        .map_err(|_| "Nemotron model loading timed out.")?.map_err(|error| error.to_string())?;
    if !ready.contains("\"ready\":true") { return Err("Nemotron could not load its streaming model.".into()); }
    *prepared = Some(StreamingProcess { child, input, output, language });
    Ok(())
}

async fn exchange(process: &mut StreamingProcess, samples: &[f32], sample_rate: u32) -> Result<LiveResult, String> {
    let mut bytes = Vec::with_capacity(8 + samples.len() * 4);
    bytes.extend_from_slice(&(samples.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&sample_rate.to_le_bytes());
    for sample in samples { bytes.extend_from_slice(&sample.to_le_bytes()); }
    process.input.write_all(&bytes).await.map_err(|error| error.to_string())?;
    process.input.flush().await.map_err(|error| error.to_string())?;
    let mut line = String::new();
    tokio::time::timeout(std::time::Duration::from_secs(30), process.output.read_line(&mut line)).await
        .map_err(|_| "Nemotron stopped responding. The original audio is still being saved.")?.map_err(|error| error.to_string())?;
    serde_json::from_str(&line).map_err(|_| "Nemotron returned an invalid transcript.".into())
}

pub async fn run<R: Runtime>(app: AppHandle<R>, mut receiver: tokio::sync::mpsc::UnboundedReceiver<AudioChunk>) {
    let outcome = async {
        let _ = app.emit("nemotron-status", "Preparing live transcription. Original audio is recording.");
        prepare(&app).await?;
        let _ = app.emit("nemotron-status", "");
        let mut process = PREPARED.lock().await.take().ok_or("Nemotron is not prepared.")?;
        let mut sequence = 1u64;
        let mut elapsed = 0.0f64;
        let mut segment_start = 0.0;
        let mut previous_text = String::new();
        while let Some(chunk) = receiver.recv().await {
            elapsed += chunk.data.len() as f64 / chunk.sample_rate as f64;
            let result = exchange(&mut process, &chunk.data, chunk.sample_rate).await?;
            if !result.text.is_empty() && (result.text != previous_text || result.final_segment) {
                let _ = app.emit("nemotron-partial", serde_json::json!({"text":result.text,"final":result.final_segment}));
                previous_text = result.text.clone();
            }
            if result.final_segment {
                emit_final(&app, result.text, sequence, segment_start, elapsed);
                sequence += 1;
                segment_start = elapsed;
                previous_text.clear();
            }
        }
        let final_result = exchange(&mut process, &[], 16000).await?;
        emit_final(&app, final_result.text, sequence, segment_start, elapsed);
        let _ = app.emit("nemotron-partial", serde_json::json!({"text":"","final":true}));
        let _ = process.child.wait().await;
        Ok::<(), String>(())
    }.await;
    if let Err(error) = outcome {
        let _ = app.emit("transcription-error", serde_json::json!({"error":error,"userMessage":error,"actionable":true}));
        // Drain audio until stop so pipeline capture and lossless recording continue.
        while receiver.recv().await.is_some() {}
    }
    let _ = app.emit("transcription-complete", serde_json::json!({"stage":"live"}));
    let next_app = app.clone();
    tokio::spawn(async move {
        if let Err(error) = prepare(&next_app).await { log::warn!("Cannot prepare the next Nemotron stream: {}", error); }
    });
}

fn emit_final<R: Runtime>(app: &AppHandle<R>, text: String, sequence: u64, start: f64, end: f64) {
    if text.trim().is_empty() { return; }
    let update = TranscriptUpdate { text, timestamp: format!("{:02}:{:02}", start as u64 / 60, start as u64 % 60), source: "Nemotron live".into(), sequence_id: sequence, chunk_start_time: start, is_partial: false, confidence: 0.0, audio_start_time: start, audio_end_time: end, duration: end - start };
    let _ = app.emit("speech-detected", ());
    let _ = app.emit("transcript-update", update);
}

#[tauri::command]
pub async fn finalize_local_transcript<R: Runtime>(app: AppHandle<R>, meeting_id: String, meeting_folder_path: String) -> Result<serde_json::Value, String> {
    let state = app.try_state::<crate::state::AppState>().ok_or("Database is not ready.")?;
    let stored: Option<String> = sqlx::query_scalar("SELECT folder_path FROM meetings WHERE id = ?").bind(&meeting_id)
        .fetch_optional(state.db_manager.pool()).await.map_err(|error| error.to_string())?.flatten();
    let stored = stored.ok_or("Meeting recording folder is missing.")?;
    let folder = std::path::Path::new(&meeting_folder_path).canonicalize().map_err(|error| error.to_string())?;
    if folder != std::path::Path::new(&stored).canonicalize().map_err(|error| error.to_string())? { return Err("Recording folder does not match the saved meeting.".into()); }
    if !folder.join("recording.wav").is_file() { return Err("The original recording.wav is missing. Live transcript retained.".into()); }
    let live = folder.join("transcripts.json");
    let live_rows: Vec<(String, String, Option<f64>, Option<f64>, Option<f64>)> = sqlx::query_as(
        "SELECT transcript, timestamp, audio_start_time, audio_end_time, duration FROM transcripts WHERE meeting_id = ? ORDER BY audio_start_time")
        .bind(&meeting_id).fetch_all(state.db_manager.pool()).await.map_err(|error| error.to_string())?;
    let live_snapshot: Vec<serde_json::Value> = live_rows.into_iter().map(|(text, timestamp, start, end, duration)|
        serde_json::json!({"text":text,"timestamp":timestamp,"audio_start_time":start,"audio_end_time":end,"duration":duration})).collect();
    if !folder.join("transcript-live.json").exists() {
        tokio::fs::write(folder.join("transcript-live.json"), serde_json::to_vec_pretty(&serde_json::json!({"model":"Nemotron streaming","transcripts":live_snapshot})).map_err(|error| error.to_string())?)
            .await.map_err(|error| error.to_string())?;
    }
    let result = super::super::retranscription::start_retranscription(app.clone(), meeting_id, folder.to_string_lossy().into(), None,
        Some(crate::config::DEFAULT_PARAKEET_MODEL.into()), Some("parakeet".into())).await.map_err(|error| error.to_string())?;
    tokio::fs::copy(&live, folder.join("transcript-final.json")).await.map_err(|error| error.to_string())?;
    tokio::fs::write(folder.join("transcription-stages.json"), serde_json::to_vec_pretty(&serde_json::json!({
        "live_model":MODEL,"final_model":crate::config::DEFAULT_PARAKEET_MODEL,
        "original_audio":"recording.wav","live_transcript":"transcript-live.json","final_transcript":"transcript-final.json","status":"final"
    })).map_err(|error| error.to_string())?).await.map_err(|error| error.to_string())?;
    Ok(serde_json::json!({"segments":result.segments_count,"status":"final"}))
}
