use std::path::PathBuf;
use anyhow::{Result, anyhow};
use log::{info, warn, error};
use super::recording_state::AudioChunk;
use serde::{Serialize, Deserialize};
use std::io::{Seek, SeekFrom, Write};

/// Lossless mixed recording audio, with a valid header after every write.
struct OriginalWav {
    file: std::fs::File,
    path: PathBuf,
    sample_rate: u32,
    bytes: u32,
}

impl OriginalWav {
    fn create(path: PathBuf, sample_rate: u32) -> Result<Self> {
        let file = std::fs::OpenOptions::new().write(true).create_new(true).open(&path)?;
        let mut wav = Self { file, path, sample_rate, bytes: 0 };
        wav.header()?;
        Ok(wav)
    }
    fn header(&mut self) -> Result<()> {
        self.file.seek(SeekFrom::Start(0))?;
        self.file.write_all(b"RIFF")?;
        self.file.write_all(&(36 + self.bytes).to_le_bytes())?;
        self.file.write_all(b"WAVEfmt ")?;
        self.file.write_all(&16u32.to_le_bytes())?;
        self.file.write_all(&3u16.to_le_bytes())?; // IEEE float preserves captured sample values.
        self.file.write_all(&1u16.to_le_bytes())?;
        self.file.write_all(&self.sample_rate.to_le_bytes())?;
        self.file.write_all(&(self.sample_rate * 4).to_le_bytes())?;
        self.file.write_all(&4u16.to_le_bytes())?;
        self.file.write_all(&32u16.to_le_bytes())?;
        self.file.write_all(b"data")?;
        self.file.write_all(&self.bytes.to_le_bytes())?;
        self.file.seek(SeekFrom::End(0))?;
        Ok(())
    }
    fn append(&mut self, samples: &[f32]) -> Result<()> {
        let length = u32::try_from(samples.len() * 4)?;
        let next = self.bytes.checked_add(length).filter(|size| *size <= u32::MAX - 36)
            .ok_or_else(|| anyhow!("Original WAV reached its file size limit"))?;
        self.file.write_all(bytemuck::cast_slice(samples))?;
        self.bytes = next;
        self.header()?;
        Ok(())
    }
}

use super::ffmpeg::find_ffmpeg_path;

#[cfg(test)]
mod original_audio_tests {
    #[test]
    fn lossless_wav_preserves_samples_and_is_decodable() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("recording.wav");
        let samples: Vec<f32> = (0..16000).map(|i| ((i as f32 * 0.1).sin()) * 0.25).collect();
        let mut wav = super::OriginalWav::create(path.clone(), 16000).unwrap();
        wav.append(&samples[..8000]).unwrap();
        wav.append(&samples[8000..]).unwrap();
        wav.file.sync_all().unwrap();
        drop(wav);
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(u32::from_le_bytes(bytes[40..44].try_into().unwrap()), 64000);
        assert_eq!(&bytes[44..], bytemuck::cast_slice::<f32, u8>(&samples));
        let decoded = crate::audio::decoder::decode_audio_file(&path).unwrap();
        assert_eq!(decoded.sample_rate, 16000);
        assert_eq!(decoded.samples.len(), samples.len());
    }

    #[test]
    #[ignore = "Requires the locally downloaded Parakeet model and synthetic speech fixture"]
    fn parakeet_final_pass_from_original_speech() {
        let audio_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.build-tools/transcription-smoke.wav");
        let decoded = crate::audio::decoder::decode_audio_file(&audio_path).unwrap();
        let audio = crate::audio::audio_processing::resample_audio(&decoded.samples, decoded.sample_rate, 16000);
        let directory = std::path::PathBuf::from(std::env::var("APPDATA").unwrap()).join("local.meetingworkspace.app/models/parakeet/parakeet-tdt-0.6b-v3-int8");
        let started = std::time::Instant::now();
        let mut model = crate::parakeet_engine::model::ParakeetModel::new(directory, true).unwrap();
        let result = model.transcribe_samples(audio).unwrap();
        println!("Parakeet final pass: {} ({}ms including model load)", result.text, started.elapsed().as_millis());
        assert!(result.text.to_lowercase().contains("meeting"));
        assert!(result.text.to_lowercase().contains("transcription"));
    }
}

/// Streams mixed audio to a recoverable WAV without holding the meeting in memory.
pub struct IncrementalAudioSaver {
    original_wav: OriginalWav,
}

impl IncrementalAudioSaver {
    pub fn new(meeting_folder: PathBuf, sample_rate: u32) -> Result<Self> {
        std::fs::create_dir_all(&meeting_folder)?;
        Ok(Self { original_wav: OriginalWav::create(meeting_folder.join("recording.wav"), sample_rate)? })
    }

    pub fn add_chunk(&mut self, chunk: AudioChunk) -> Result<()> {
        if chunk.sample_rate != self.original_wav.sample_rate {
            return Err(anyhow!("Original audio sample rate changed"));
        }
        self.original_wav.append(&chunk.data)
    }

    pub async fn finalize(&mut self) -> Result<PathBuf> {
        if self.original_wav.bytes == 0 { return Err(anyhow!("No original audio was captured")); }
        self.original_wav.file.sync_all()?;
        Ok(self.original_wav.path.clone())
    }

    pub fn get_stats(&self) -> (usize, u32) {
        (self.original_wav.bytes as usize / 4, self.original_wav.sample_rate)
    }
}

/// Audio recovery status for transcript recovery feature
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioRecoveryStatus {
    pub status: String, // "success" | "partial" | "failed" | "none"
    pub chunk_count: u32,
    pub estimated_duration_seconds: f64,
    pub audio_file_path: Option<String>,
    pub message: String,
}

/// Recover audio from checkpoint files
/// This is called by the transcript recovery system to merge audio chunks after a crash
#[tauri::command]
pub async fn recover_audio_from_checkpoints(
    meeting_folder: String,
    _sample_rate: u32
) -> Result<AudioRecoveryStatus, String> {
    info!("Starting audio recovery for folder: {}", meeting_folder);

    let folder_path = PathBuf::from(&meeting_folder);
    let checkpoints_dir = folder_path.join(".checkpoints");

    // Check if checkpoints directory exists
    if !checkpoints_dir.exists() {
        info!("No checkpoints directory found at: {}", checkpoints_dir.display());
        return Ok(AudioRecoveryStatus {
            status: "none".to_string(),
            chunk_count: 0,
            estimated_duration_seconds: 0.0,
            audio_file_path: None,
            message: "No audio checkpoints found".to_string(),
        });
    }

    // Scan for checkpoint files
    let mut checkpoint_files: Vec<_> = std::fs::read_dir(&checkpoints_dir)
        .map_err(|e| format!("Failed to read checkpoints directory: {}", e))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry.path().extension().and_then(|s| s.to_str()) == Some("mp4")
        })
        .collect();

    if checkpoint_files.is_empty() {
        info!("No checkpoint files found in: {}", checkpoints_dir.display());
        return Ok(AudioRecoveryStatus {
            status: "none".to_string(),
            chunk_count: 0,
            estimated_duration_seconds: 0.0,
            audio_file_path: None,
            message: "No audio checkpoint files found".to_string(),
        });
    }

    // Sort by filename (audio_chunk_000.mp4, audio_chunk_001.mp4, etc.)
    checkpoint_files.sort_by_key(|entry| entry.path());

    let chunk_count = checkpoint_files.len() as u32;
    let estimated_duration = (chunk_count as f64) * 30.0; // 30 seconds per chunk

    info!("Found {} checkpoint files, estimated duration: {:.2}s", chunk_count, estimated_duration);

    // Create FFmpeg concat file
    let concat_file_path = checkpoints_dir.join("concat_list.txt");
    let mut concat_content = String::new();

    for entry in &checkpoint_files {
        let path = entry.path().canonicalize()
            .map_err(|e| format!("Failed to canonicalize path: {}", e))?;
        concat_content.push_str(&format!("file '{}'\n", path.display()));
    }

    std::fs::write(&concat_file_path, concat_content)
        .map_err(|e| format!("Failed to write concat file: {}", e))?;

    // Run FFmpeg to merge chunks
    let output_path = folder_path.join("audio.mp4");
    let output_path_str = output_path.to_str()
        .ok_or("Invalid output path")?
        .to_string();

    let ffmpeg_path = find_ffmpeg_path()
        .ok_or_else(|| "FFmpeg not found. Please install FFmpeg to recover audio.".to_string())?;
    info!("Using FFmpeg at: {:?}", ffmpeg_path);

    let mut command = std::process::Command::new(ffmpeg_path);

    command.args(&[
        "-f", "concat",
        "-safe", "0",
        "-i", concat_file_path.to_str().unwrap(),
        "-c", "copy",
        "-y", // Overwrite if exists
        &output_path_str
    ]);

    // Hide console window on Windows
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let ffmpeg_result = command.output();

    match ffmpeg_result {
        Ok(output) if output.status.success() => {
            // Clean up concat file
            let _ = std::fs::remove_file(concat_file_path);

            info!("Successfully recovered audio: {}", output_path_str);

            Ok(AudioRecoveryStatus {
                status: "success".to_string(),
                chunk_count,
                estimated_duration_seconds: estimated_duration,
                audio_file_path: Some(output_path_str),
                message: format!("Successfully recovered {} audio chunks", chunk_count),
            })
        }
        Ok(output) => {
            let error = String::from_utf8_lossy(&output.stderr);
            error!("FFmpeg recovery failed: {}", error);
            Ok(AudioRecoveryStatus {
                status: "failed".to_string(),
                chunk_count,
                estimated_duration_seconds: estimated_duration,
                audio_file_path: None,
                message: format!("FFmpeg failed: {}", error),
            })
        }
        Err(e) => {
            error!("Failed to run FFmpeg: {}", e);
            Ok(AudioRecoveryStatus {
                status: "failed".to_string(),
                chunk_count,
                estimated_duration_seconds: estimated_duration,
                audio_file_path: None,
                message: format!("Failed to run FFmpeg: {}", e),
            })
        }
    }
}

/// Clean up checkpoint files after successful recording or recovery
/// This command is called by the frontend after successful save to clean up checkpoint files
#[tauri::command]
pub async fn cleanup_checkpoints(meeting_folder: String) -> Result<(), String> {
    info!("Cleaning up checkpoints for folder: {}", meeting_folder);

    let folder_path = PathBuf::from(&meeting_folder);
    let checkpoints_dir = folder_path.join(".checkpoints");

    if checkpoints_dir.exists() {
        std::fs::remove_dir_all(&checkpoints_dir)
            .map_err(|e| format!("Failed to remove checkpoints directory: {}", e))?;
        info!("Successfully cleaned up checkpoints directory");
    } else {
        info!("No checkpoints directory to clean up");
    }

    Ok(())
}

/// Check if a meeting folder has audio checkpoint files
/// Returns true if .checkpoints/ directory exists and contains .mp4 files
#[tauri::command]
pub async fn has_audio_checkpoints(meeting_folder: String) -> Result<bool, String> {
    let folder_path = PathBuf::from(&meeting_folder);
    let checkpoints_dir = folder_path.join(".checkpoints");

    // Check if checkpoints directory exists
    if !checkpoints_dir.exists() {
        return Ok(false);
    }

    // Scan for .mp4 checkpoint files
    let has_mp4_files = std::fs::read_dir(&checkpoints_dir)
        .map_err(|e| format!("Failed to read checkpoints directory: {}", e))?
        .filter_map(|entry| entry.ok())
        .any(|entry| {
            entry.path().extension().and_then(|s| s.to_str()) == Some("mp4")
        });

    Ok(has_mp4_files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use super::super::recording_state::DeviceType;

    #[tokio::test]
    async fn test_checkpoint_creation() {
        // Create temp meeting folder
        let temp_dir = tempdir().unwrap();
        let meeting_folder = temp_dir.path().join("Test_Meeting");
        std::fs::create_dir_all(&meeting_folder).unwrap();
        std::fs::create_dir_all(meeting_folder.join(".checkpoints")).unwrap();

        let mut saver = IncrementalAudioSaver::new(
            meeting_folder.clone(),
            48000
        ).unwrap();

        // Add 60 seconds worth of audio (should create 2 checkpoints)
        for i in 0..120 {  // 120 chunks of 0.5s each
            let chunk = AudioChunk {
                data: vec![0.5f32; 24000],  // 0.5s at 48kHz
                sample_rate: 48000,
                timestamp: i as f64 * 0.5,  // timestamp in seconds
                chunk_id: i as u64,
                device_type: DeviceType::Microphone,
            };
            saver.add_chunk(chunk).unwrap();
        }

        // Every captured sample is preserved in the incremental WAV.
        assert_eq!(saver.get_stats(), (60 * 48000, 48000));

        // Finalize and verify merge
        let final_path = saver.finalize().await.unwrap();
        assert!(final_path.exists());

        let decoded = crate::audio::decoder::decode_audio_file(&final_path).unwrap();
        assert_eq!(decoded.samples.len(), 60 * 48000);
        assert!(decoded.samples.iter().all(|sample| *sample == 0.5));
    }

    #[tokio::test]
    async fn test_empty_recording() {
        let temp_dir = tempdir().unwrap();
        let meeting_folder = temp_dir.path().join("Empty_Test");
        std::fs::create_dir_all(&meeting_folder).unwrap();
        std::fs::create_dir_all(meeting_folder.join(".checkpoints")).unwrap();

        let mut saver = IncrementalAudioSaver::new(
            meeting_folder.clone(),
            48000
        ).unwrap();

        // Try to finalize without adding any chunks
        let result = saver.finalize().await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("No original audio"));
    }
}
