use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_store::StoreExt;

use crate::audio::vad::SpeechSegment;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpeakerSettings {
    pub enabled: bool,
    /// Zero estimates the number of speakers automatically.
    pub speaker_count: u32,
}

impl Default for SpeakerSettings {
    fn default() -> Self { Self { enabled: true, speaker_count: 0 } }
}

#[tauri::command]
pub fn get_speaker_settings<R: Runtime>(app: AppHandle<R>) -> Result<SpeakerSettings, String> {
    let store = app.store("speakers.json").map_err(|e| e.to_string())?;
    let settings = store.get("settings").map(serde_json::from_value).transpose()
        .map_err(|e| format!("Could not read speaker settings: {e}"))?.unwrap_or_default();
    validate_settings(&settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn set_speaker_settings<R: Runtime>(app: AppHandle<R>, settings: SpeakerSettings) -> Result<(), String> {
    validate_settings(&settings)?;
    let store = app.store("speakers.json").map_err(|e| e.to_string())?;
    store.set("settings", serde_json::to_value(settings).map_err(|e| e.to_string())?);
    store.save().map_err(|e| format!("Could not save speaker settings: {e}"))
}

fn validate_settings(settings: &SpeakerSettings) -> Result<(), String> {
    if settings.speaker_count > 20 { return Err("Choose Auto (0) or 1–20 speakers.".into()); }
    Ok(())
}

pub fn runtime_directory<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    let bundled = app.path().resource_dir()?.join("speaker-runtime");
    if bundled.join("segmentation.onnx").is_file() { return Ok(bundled); }
    if cfg!(debug_assertions) || cfg!(test) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("speaker-runtime"));
    }
    Err(anyhow!("Speaker detection files are missing. Keep the speaker-runtime folder beside the app, or turn off speaker detection in Settings > Transcription."))
}

#[derive(Debug, Clone, PartialEq)]
pub struct SpeakerTurn {
    pub start: f64,
    pub end: f64,
    pub label: String,
}

/// Run only on saved audio, before loading the speech model. The child process
/// releases its models when it exits and cannot contact a hosted inference API.
pub fn detect_speakers(
    samples: &[f32], directory: &Path, settings: &SpeakerSettings,
    cancelled: impl Fn() -> bool,
) -> Result<Vec<SpeakerTurn>> {
    if !settings.enabled || samples.is_empty() { return Ok(Vec::new()); }
    if cancelled() { return Err(anyhow!("Speaker detection cancelled")); }
    if settings.speaker_count == 1 {
        return Ok(vec![SpeakerTurn { start: 0.0, end: samples.len() as f64 / 16000.0, label: "Speaker 1".into() }]);
    }
    let executable = directory.join(if cfg!(windows) {
        "sherpa-onnx-offline-speaker-diarization.exe"
    } else { "sherpa-onnx-offline-speaker-diarization" });
    for path in [&executable, &directory.join("segmentation.onnx"), &directory.join("embedding.onnx")] {
        if !path.is_file() { return Err(anyhow!("Local speaker detection files are missing. Restore the speaker-runtime folder or turn off speaker detection in Settings > Transcription.")); }
    }
    if cancelled() { return Err(anyhow!("Speaker detection cancelled")); }
    let work = tempfile::tempdir()?;
    let audio = work.path().join("audio.wav");
    write_mono_wave(&audio, samples)?;
    let output_path = work.path().join("turns.txt");
    let error_path = work.path().join("diagnostics.txt");
    let threads = std::thread::available_parallelism().map(usize::from).unwrap_or(1).min(4);
    let mut command = Command::new(executable);
    command.arg(format!("--segmentation.pyannote-model={}", directory.join("segmentation.onnx").display()))
        .arg(format!("--embedding.model={}", directory.join("embedding.onnx").display()))
        .arg(format!("--segmentation.num-threads={threads}"))
        .arg(format!("--embedding.num-threads={threads}"))
        .arg(format!("--clustering.num-clusters={}", if settings.speaker_count == 0 { -1 } else { settings.speaker_count as i32 }))
        .arg("--clustering.cluster-threshold=0.8")
        .arg("--print-args=false").arg(audio)
        .stdin(Stdio::null())
        .stdout(std::fs::File::create(&output_path)?)
        .stderr(std::fs::File::create(&error_path)?);
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000 | 0x00004000); // No console, below-normal priority.
    }
    let mut child = command.spawn().context("Could not start local speaker detection")?;
    let started = Instant::now();
    let deadline = Duration::from_secs_f64((samples.len() as f64 / 16000.0 * 4.0 + 120.0).max(180.0));
    loop {
        if cancelled() || started.elapsed() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(anyhow!(if cancelled() { "Speaker detection cancelled" } else { "Speaker detection timed out. Retry with a known speaker count, or turn it off in Settings > Transcription." }));
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() { return Err(anyhow!("Local speaker detection failed. Retry or turn it off in Settings > Transcription; the original audio is still saved.")); }
                break;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(error) => { let _ = child.kill(); let _ = child.wait(); return Err(error.into()); }
        }
    }
    parse_turns(&std::fs::read_to_string(output_path)?, samples.len() as f64 / 16000.0)
}

fn write_mono_wave(path: &Path, samples: &[f32]) -> Result<()> {
    let bytes = u32::try_from(samples.len().checked_mul(2).ok_or_else(|| anyhow!("Recording is too large"))?)?;
    let riff_size = bytes.checked_add(36).ok_or_else(|| anyhow!("Recording is too large"))?;
    let mut file = std::io::BufWriter::new(std::fs::File::create(path)?);
    file.write_all(b"RIFF")?; file.write_all(&riff_size.to_le_bytes())?; file.write_all(b"WAVEfmt ")?;
    file.write_all(&16u32.to_le_bytes())?; file.write_all(&1u16.to_le_bytes())?; file.write_all(&1u16.to_le_bytes())?;
    file.write_all(&16000u32.to_le_bytes())?; file.write_all(&32000u32.to_le_bytes())?;
    file.write_all(&2u16.to_le_bytes())?; file.write_all(&16u16.to_le_bytes())?;
    file.write_all(b"data")?; file.write_all(&bytes.to_le_bytes())?;
    for &sample in samples {
        let value = if sample.is_finite() { (sample.clamp(-1.0, 1.0) * 32767.0).round() as i16 } else { 0 };
        file.write_all(&value.to_le_bytes())?;
    }
    file.flush()?;
    Ok(())
}

fn parse_turns(output: &str, duration: f64) -> Result<Vec<SpeakerTurn>> {
    let mut turns = Vec::new();
    let mut names = HashMap::new();
    for line in output.lines() {
        let fields: Vec<_> = line.split_whitespace().collect();
        if fields.len() != 4 || fields[1] != "--" { continue; }
        let start: f64 = fields[0].parse()?;
        let end: f64 = fields[2].parse()?;
        let id: u32 = fields[3].strip_prefix("speaker_").ok_or_else(|| anyhow!("Invalid speaker label"))?.parse()?;
        if !start.is_finite() || !end.is_finite() || start < 0.0 || end <= start || end > duration + 0.1 {
            return Err(anyhow!("Invalid timestamps from local speaker detection"));
        }
        let next = names.len() + 1;
        let label = names.entry(id).or_insert_with(|| format!("Speaker {next}")).clone();
        turns.push(SpeakerTurn { start, end: end.min(duration), label });
    }
    turns.sort_by(|a, b| a.start.total_cmp(&b.start));
    Ok(turns)
}

/// Partition VAD audio at speaker changes without dropping samples or inventing
/// a single speaker when two voices overlap. Unassigned speech stays unlabelled.
pub fn label_segments(segments: Vec<SpeechSegment>, turns: &[SpeakerTurn]) -> Vec<SpeechSegment> {
    if turns.is_empty() { return segments; }
    let mut result = Vec::new();
    let mut cursor = 0;
    for segment in segments {
        let start = segment.start_timestamp_ms / 1000.0;
        let end = start + segment.samples.len() as f64 / 16000.0;
        while cursor < turns.len() && turns[cursor].end <= start { cursor += 1; }
        let relevant: Vec<_> = turns[cursor..].iter().take_while(|turn| turn.start < end)
            .filter(|turn| turn.end > start).collect();
        if relevant.is_empty() { result.push(segment); continue; }
        let mut cuts = vec![0, segment.samples.len()];
        for turn in &relevant {
            for time in [turn.start, turn.end] {
                cuts.push(((time - start).max(0.0) * 16000.0).round().min(segment.samples.len() as f64) as usize);
            }
        }
        cuts.sort_unstable(); cuts.dedup();
        let mut ranges: Vec<(usize, usize, Option<String>)> = Vec::new();
        for pair in cuts.windows(2) {
            let midpoint = start + (pair[0] + pair[1]) as f64 / 32000.0;
            let labels: BTreeSet<_> = relevant.iter().filter(|turn| turn.start <= midpoint && turn.end > midpoint).map(|turn| turn.label.as_str()).collect();
            let label = match labels.len() {
                0 => None, 1 => labels.first().map(|s| s.to_string()), _ => Some("Multiple speakers".into()),
            };
            // Attach a short unassigned edge to its adjacent turn to avoid tiny ASR jobs.
            if let Some(previous) = ranges.last_mut() {
                if previous.2 == label || (label.is_none() && pair[1] - pair[0] < 3200) {
                    previous.1 = pair[1]; continue;
                }
                if previous.2.is_none() && previous.1 - previous.0 < 3200 {
                    previous.1 = pair[1]; previous.2 = label; continue;
                }
            }
            ranges.push((pair[0], pair[1], label));
        }
        if ranges.len() == 1 {
            result.push(SpeechSegment { speaker: ranges.pop().unwrap().2, ..segment });
            continue;
        }
        for (from, to, speaker) in ranges {
            result.push(SpeechSegment {
                samples: segment.samples[from..to].to_vec(),
                start_timestamp_ms: segment.start_timestamp_ms + from as f64 / 16.0,
                end_timestamp_ms: segment.start_timestamp_ms + to as f64 / 16.0,
                confidence: segment.confidence,
                speaker,
            });
        }
    }
    result
}

#[tauri::command]
pub async fn list_meeting_speakers(app: AppHandle, meeting_id: String) -> Result<Vec<String>, String> {
    let state = app.state::<crate::state::AppState>();
    sqlx::query_scalar("SELECT DISTINCT speaker FROM transcripts WHERE meeting_id = ? AND speaker IS NOT NULL AND speaker <> 'Multiple speakers' ORDER BY speaker")
        .bind(meeting_id).fetch_all(state.db_manager.pool()).await.map_err(|e| e.to_string())
}

async fn rename_in_database(pool: &sqlx::SqlitePool, meeting_id: &str, speaker: &str, name: &str) -> Result<(), String> {
    let name = name.trim();
    if speaker == "Multiple speakers" || name == "Multiple speakers" {
        return Err("Overlapping speech cannot be assigned a single speaker name.".into());
    }
    if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err("Enter a speaker name of 1–80 characters without line breaks.".into());
    }
    if name == speaker { return Ok(()); }
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM transcripts WHERE meeting_id = ? AND speaker = ?")
        .bind(&meeting_id).bind(name).fetch_one(&mut *tx).await.map_err(|e| e.to_string())?;
    if exists > 0 { return Err("That name already belongs to another speaker in this meeting.".into()); }
    let updated = sqlx::query("UPDATE transcripts SET speaker = ? WHERE meeting_id = ? AND speaker = ?")
        .bind(name).bind(&meeting_id).bind(&speaker).execute(&mut *tx).await.map_err(|e| e.to_string())?;
    if updated.rows_affected() == 0 { return Err("Speaker not found. Refresh the meeting and try again.".into()); }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn rename_meeting_speaker(app: AppHandle, meeting_id: String, speaker: String, name: String) -> Result<(), String> {
    let state = app.state::<crate::state::AppState>();
    let pool = state.db_manager.pool();
    rename_in_database(pool, &meeting_id, &speaker, &name).await?;
    // The database is authoritative. Refresh the portable transcript copy too.
    let folder: Option<String> = sqlx::query_scalar("SELECT folder_path FROM meetings WHERE id = ?")
        .bind(&meeting_id).fetch_one(pool).await.map_err(|e| e.to_string())?;
    if let Some(folder) = folder {
        let rows = sqlx::query_as::<_, crate::database::models::Transcript>("SELECT * FROM transcripts WHERE meeting_id = ? ORDER BY audio_start_time")
            .bind(&meeting_id).fetch_all(pool).await.map_err(|e| e.to_string())?;
        let segments = rows.into_iter().map(|t| crate::api::TranscriptSegment {
            id: t.id, text: t.transcript, timestamp: t.timestamp, audio_start_time: t.audio_start_time,
            audio_end_time: t.audio_end_time, duration: t.duration, speaker: t.speaker,
        }).collect::<Vec<_>>();
        crate::audio::common::write_transcripts_json(Path::new(&folder), &segments)
            .map_err(|e| format!("Name saved in the app, but the transcript file could not be updated: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn speaker_labels_survive_database_reads_and_renaming_is_meeting_scoped() {
        use crate::database::repositories::{meeting::MeetingsRepository, transcript::TranscriptsRepository};
        let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let segments = vec![crate::api::TranscriptSegment {
            id: "test".into(), text: "Release Friday".into(), timestamp: "2026-10-06T10:00:00Z".into(),
            audio_start_time: Some(1.0), audio_end_time: Some(3.0), duration: Some(2.0), speaker: Some("Speaker 1".into()),
        }];
        let first = TranscriptsRepository::save_transcript(&pool, "First", &segments, None).await.unwrap();
        let second = TranscriptsRepository::save_transcript(&pool, "Second", &segments, None).await.unwrap();
        rename_in_database(&pool, &first, "Speaker 1", "Maya").await.unwrap();
        let first = MeetingsRepository::get_meeting(&pool, &first).await.unwrap().unwrap();
        let second = MeetingsRepository::get_meeting(&pool, &second).await.unwrap().unwrap();
        assert_eq!(first.transcripts[0].speaker.as_deref(), Some("Maya"));
        assert_eq!(second.transcripts[0].speaker.as_deref(), Some("Speaker 1"));
        assert!(rename_in_database(&pool, &first.id, "Maya", "\n").await.is_err());
        assert!(rename_in_database(&pool, &first.id, "Missing", "Luis").await.is_err());
        let folder = tempfile::tempdir().unwrap();
        crate::audio::common::write_transcripts_json(folder.path(), &segments).unwrap();
        let saved: serde_json::Value = serde_json::from_slice(&std::fs::read(folder.path().join("transcripts.json")).unwrap()).unwrap();
        assert_eq!(saved["segments"][0]["speaker"], "Speaker 1");
    }

    #[test]
    fn parses_native_output_and_rejects_invalid_timestamps() {
        let turns = parse_turns("Started\n0.000 -- 1.000 speaker_03\n1.000 -- 2.000 speaker_01\n2.000 -- 3.000 speaker_03", 3.0).unwrap();
        assert_eq!(turns[0].label, "Speaker 1"); assert_eq!(turns[1].label, "Speaker 2"); assert_eq!(turns[2].label, "Speaker 1");
        assert!(parse_turns("NaN -- 1.000 speaker_00", 3.0).is_err());
        assert!(parse_turns("0.000 -- 99.000 speaker_00", 3.0).is_err());
    }

    #[test]
    fn disabled_detection_needs_no_models_and_settings_are_bounded() {
        assert!(detect_speakers(&[0.5; 100], Path::new("missing"), &SpeakerSettings { enabled: false, speaker_count: 0 }, || false).unwrap().is_empty());
        assert!(validate_settings(&SpeakerSettings { enabled: true, speaker_count: 21 }).is_err());
        assert!(validate_settings(&SpeakerSettings::default()).is_ok());
    }

    #[test]
    fn wave_bridge_preserves_duration_and_converts_to_mono_pcm() {
        let work = tempfile::tempdir().unwrap();
        let path = work.path().join("test.wav");
        write_mono_wave(&path, &[0.5, -1.0, f32::NAN, 2.0]).unwrap();
        let audio = crate::audio::decoder::decode_audio_file(&path).unwrap();
        assert_eq!(audio.sample_rate, 16000); assert_eq!(audio.channels, 1);
        assert_eq!(audio.samples.len(), 4); assert_eq!(audio.samples[2], 0.0);
        assert!((audio.samples[0] - 0.5).abs() < 0.0001);
    }

    #[test]
    fn speaker_boundaries_preserve_audio_and_mark_overlap() {
        let samples: Vec<f32> = (0..48000).map(|i| i as f32).collect();
        let segments = vec![SpeechSegment { samples: samples.clone(), start_timestamp_ms: 1000.0, end_timestamp_ms: 4000.0, confidence: 0.9, speaker: None }];
        let turns = vec![SpeakerTurn { start: 1.0, end: 3.0, label: "Speaker 1".into() }, SpeakerTurn { start: 2.0, end: 4.0, label: "Speaker 2".into() }];
        let labelled = label_segments(segments, &turns);
        assert_eq!(labelled.len(), 3);
        assert_eq!(labelled[1].speaker.as_deref(), Some("Multiple speakers"));
        assert_eq!(labelled.iter().flat_map(|s| s.samples.iter().copied()).collect::<Vec<_>>(), samples);
        assert_eq!(labelled[2].end_timestamp_ms, 4000.0);
    }

    #[test]
    #[ignore = "Requires the bundled runtime/models and the sherpa four-speaker fixture"]
    fn local_four_speaker_smoke() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let audio = crate::audio::decoder::decode_audio_file(&root.join("../.build-tools/speakers/four-speakers.wav")).unwrap().into_whisper_format();
        for speaker_count in [0, 4] {
            let started = Instant::now();
            let turns = detect_speakers(&audio, &root.join("speaker-runtime"), &SpeakerSettings { enabled: true, speaker_count }, || false).unwrap();
            let names: BTreeSet<_> = turns.iter().map(|turn| &turn.label).collect();
            assert_eq!(names.len(), 4); assert!(turns.len() >= 8);
            println!("Local speaker detection (count {speaker_count}): {} turns, {} speakers, {:.2}s", turns.len(), names.len(), started.elapsed().as_secs_f64());
        }
    }
}
