// Commit name to recover the serial whisper engine processing for smaller meetings [Slower processing but dooes not fail] - "before parallel processing implementation"

use std::path::{PathBuf};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::RwLock;
use whisper_rs::{WhisperContext, WhisperContextParameters, WhisperState, FullParams, SamplingStrategy};
use serde::{Serialize, Deserialize};
use anyhow::{Result, anyhow};
use reqwest::Client;
use tokio::fs;
use tokio::io::AsyncWriteExt;
use crate::config::{SWISS_GERMAN_CHECKPOINT, SWISS_GERMAN_WHISPER_MODEL, WHISPER_MODEL_CATALOG};
use super::acceleration::{whisper_context_acceleration_for, WhisperCompiledBackend};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ModelStatus {
    Available,
    Missing,
    Downloading { progress: u8 },
    Error(String),
    Corrupted { file_size: u64, expected_min_size: u64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub name: String,
    pub path: PathBuf,
    pub size_mb: u32,
    pub accuracy: String,
    pub speed: String,
    pub status: ModelStatus,
    pub description: String,
}

pub struct WhisperEngine {
    models_dir: PathBuf,
    current_context: Arc<RwLock<Option<WhisperContext>>>,
    /// Decoder state for the loaded model, reused across segments instead of reallocated per call.
    current_state: Arc<tokio::sync::Mutex<Option<WhisperState>>>,
    current_model: Arc<RwLock<Option<String>>>,
    available_models: Arc<RwLock<HashMap<String, ModelInfo>>>,
    // State tracking for smart logging
    last_transcription_was_short: Arc<RwLock<bool>>,
    short_audio_warning_logged: Arc<RwLock<bool>>,
    // Performance optimization: reduce logging frequency
    transcription_count: Arc<RwLock<u64>>,
    // Download cancellation tracking
    cancel_download_flag: Arc<RwLock<Option<String>>>, // Model name being cancelled
    // Active downloads tracking to prevent concurrent downloads
    active_downloads: Arc<RwLock<HashSet<String>>>, // Set of models currently being downloaded
}

impl WhisperEngine {
    /// Detect available GPU acceleration capabilities
    fn detect_gpu_acceleration() -> bool {
        match WhisperCompiledBackend::current() {
            WhisperCompiledBackend::Metal => {
                log::info!("macOS detected - attempting to enable Metal GPU acceleration");
                true
            }
            WhisperCompiledBackend::Cuda => {
                log::info!("CUDA feature enabled - attempting GPU acceleration");
                true
            }
            WhisperCompiledBackend::Vulkan => {
                log::info!("Vulkan feature enabled - attempting GPU acceleration");
                true
            }
            WhisperCompiledBackend::HipBlas => {
                log::info!("HIP BLAS feature enabled - attempting GPU acceleration");
                true
            }
            WhisperCompiledBackend::Cpu => {
                log::info!("No GPU acceleration features detected - using CPU processing");
                false
            }
        }
    }

    pub fn new() -> Result<Self> {
        Self::new_with_models_dir(None)
    }

    /// Create a new WhisperEngine with optional custom models directory
    /// If models_dir is None, uses default location (app data dir for production, local for dev)
    pub fn new_with_models_dir(models_dir: Option<PathBuf>) -> Result<Self> {
        // PERFORMANCE: Suppress verbose whisper.cpp and Metal logs
        // These C library logs bypass Rust logging and clutter output
        // Set environment variables to reduce C library verbosity
        std::env::set_var("GGML_METAL_LOG_LEVEL", "1"); // 0=off, 1=error, 2=warn, 3=info
        std::env::set_var("WHISPER_LOG_LEVEL", "1");    // Reduce whisper.cpp verbosity

        let models_dir = if let Some(dir) = models_dir {
            // Use provided directory (for production with app_data_dir)
            dir
        } else {
            // Fallback: determine based on debug/release mode
            let current_dir = std::env::current_dir()
                .map_err(|e| anyhow!("Failed to get current directory: {}", e))?;

            // Development: Use frontend/models or backend directories
            // Production: Use system directories (should be overridden by caller)
            if cfg!(debug_assertions) {
                // Development mode - try frontend and backend directories
                if current_dir.join("models").exists() {
                    current_dir.join("models")
                } else if current_dir.join("../models").exists() {
                    current_dir.join("../models")
                } else {
                    // Create models directory in current directory for development
                    current_dir.join("models")
                }
            } else {
                // Production mode fallback (shouldn't reach here, caller should provide path)
                log::warn!("WhisperEngine: No models directory provided, using fallback path");
                dirs::data_dir()
                    .or_else(|| dirs::home_dir())
                    .ok_or_else(|| anyhow!("Could not find system data directory"))?
                    .join("Meeting Workspace")
                    .join("models")
            }
        };

        log::info!("WhisperEngine using models directory: {}", models_dir.display());
        log::info!("Debug mode: {}", cfg!(debug_assertions));

        // Log acceleration capabilities
        let gpu_support = Self::detect_gpu_acceleration();
        log::info!("Hardware acceleration support: {}", if gpu_support { "enabled" } else { "disabled" });

        #[cfg(feature = "metal")]
        log::info!("Apple Metal GPU support: enabled");

        #[cfg(feature = "openblas")]
        log::info!("OpenBLAS CPU optimization: enabled");

        #[cfg(feature = "coreml")]
        log::info!("Apple CoreML support: enabled");

        #[cfg(feature = "cuda")]
        log::info!("NVIDIA CUDA support: enabled");

        #[cfg(feature = "vulkan")]
        log::info!("Vulkan GPU support: enabled");

        #[cfg(feature = "openmp")]
        log::info!("OpenMP parallel processing: enabled");

        let engine = Self {
            models_dir,
            current_context: Arc::new(RwLock::new(None)),
            current_state: Arc::new(tokio::sync::Mutex::new(None)),
            current_model: Arc::new(RwLock::new(None)),
            available_models: Arc::new(RwLock::new(HashMap::new())),
            // Initialize state tracking
            last_transcription_was_short: Arc::new(RwLock::new(false)),
            short_audio_warning_logged: Arc::new(RwLock::new(false)),
            // Performance optimization: reduce logging frequency
            transcription_count: Arc::new(RwLock::new(0)),
            // Initialize cancellation tracking
            cancel_download_flag: Arc::new(RwLock::new(None)),
            // Initialize active downloads tracking
            active_downloads: Arc::new(RwLock::new(HashSet::new())),
        };

        Ok(engine)
    }

    pub async fn discover_models(&self) -> Result<Vec<ModelInfo>> {
        let models_dir = &self.models_dir;
        let mut models = Vec::new();
        // Use centralized model catalog from config.rs
        let model_configs = WHISPER_MODEL_CATALOG;

        for &(name, filename, size_mb, accuracy, speed, description) in model_configs {
            let model_path = models_dir.join(filename);
            // Converted models are written to a temporary file, so the model file alone cannot tell.
            let downloading = if self.active_downloads.read().await.contains(name) {
                match self.available_models.read().await.get(name).map(|model| &model.status) {
                    Some(ModelStatus::Downloading { progress }) => Some(*progress),
                    _ => Some(0),
                }
            } else {
                None
            };
            let status = if let Some(progress) = downloading {
                ModelStatus::Downloading { progress }
            } else if model_path.exists() {
                // Check if file size is reasonable (at least 1MB for a valid model)
                match std::fs::metadata(&model_path) {
                    Ok(metadata) => {
                        let file_size_bytes = metadata.len();
                        let file_size_mb = file_size_bytes / (1024 * 1024);
                        let expected_min_size_mb = (size_mb as f64 * 0.9) as u64; // Allow 90% of expected size as minimum for more accurate corruption detection

                        if file_size_mb >= expected_min_size_mb && file_size_mb > 1 {
                            // File size looks good, but let's also check if it's a valid GGML file
                            match self.validate_model_file(&model_path).await {
                                Ok(_) => ModelStatus::Available,
                                Err(_) => {
                                    log::warn!("Model file {} has correct size but appears corrupted (failed validation)",
                                             filename);
                                    ModelStatus::Corrupted {
                                        file_size: file_size_bytes,
                                        expected_min_size: (expected_min_size_mb * 1024 * 1024) as u64
                                    }
                                }
                            }
                        } else if file_size_mb > 0 {
                            // File exists but is smaller than expected
                            // Check if this model is currently being downloaded
                            let models_guard = self.available_models.read().await;
                            if let Some(existing_model) = models_guard.get(name) {
                                match &existing_model.status {
                                    ModelStatus::Downloading { progress } => {
                                        log::debug!("Model {} appears to be downloading ({} MB so far, {}% complete)",
                                                  filename, file_size_mb, progress);
                                        ModelStatus::Downloading { progress: *progress }
                                    }
                                    _ => {
                                        log::warn!("Model file {} exists but is corrupted ({} MB, expected ~{} MB)",
                                                 filename, file_size_mb, size_mb);
                                        ModelStatus::Corrupted {
                                            file_size: file_size_bytes,
                                            expected_min_size: (expected_min_size_mb * 1024 * 1024) as u64
                                        }
                                    }
                                }
                            } else {
                                log::warn!("Model file {} exists but is corrupted ({} MB, expected ~{} MB)",
                                         filename, file_size_mb, size_mb);
                                ModelStatus::Corrupted {
                                    file_size: file_size_bytes,
                                    expected_min_size: (expected_min_size_mb * 1024 * 1024) as u64
                                }
                            }
                        } else {
                            ModelStatus::Missing
                        }
                    }
                    Err(_) => ModelStatus::Missing
                }
            } else {
                ModelStatus::Missing
            };

            let model_info = ModelInfo {
                name: name.to_string(),
                path: model_path,
                size_mb: size_mb as u32,
                accuracy: accuracy.to_string(),
                speed: speed.to_string(),
                status,
                description: description.to_string(),
            };

            models.push(model_info);
        }

        // Update internal cache
        let mut available_models = self.available_models.write().await;
        available_models.clear();
        for model in &models {
            available_models.insert(model.name.clone(), model.clone());
        }

        Ok(models)
    }

    pub async fn load_model(&self, model_name: &str) -> Result<()> {
        let models = self.available_models.read().await;
        let model_info = models.get(model_name)
            .ok_or_else(|| anyhow!("Model {} not found", model_name))?;

        match model_info.status {
            ModelStatus::Available => {
                // FIX 5: Check if this model is already loaded
                if let Some(current_model) = self.current_model.read().await.as_ref() {
                    if current_model == model_name {
                        log::info!("Model {} is already loaded, skipping reload", model_name);
                        return Ok(());
                    }

                    // FIX 5: Unload current model before loading new one
                    log::info!("Unloading current model '{}' before loading '{}'", current_model, model_name);
                    self.unload_model().await;
                }

                log::info!("Loading model: {}", model_name);

                // PERFORMANCE OPTIMIZATION: Use comprehensive hardware profile for optimal GPU configuration
                let hardware_profile = crate::audio::HardwareProfile::detect();
                let adaptive_config = hardware_profile.get_whisper_config();
                let acceleration = whisper_context_acceleration_for(
                    WhisperCompiledBackend::current(),
                    hardware_profile.gpu_type,
                    hardware_profile.performance_tier,
                );

                let context_param = WhisperContextParameters {
                    use_gpu: acceleration.use_gpu,
                    gpu_device: acceleration.gpu_device,
                    flash_attn: acceleration.flash_attn,
                    ..Default::default()
                };

                log::info!(
                    "Whisper acceleration decision: compiled_backend={} runtime_detected_gpu={:?} use_gpu={} flash_attn={} gpu_device={}",
                    acceleration.compiled_backend.as_str(),
                    acceleration.runtime_detected_gpu,
                    acceleration.use_gpu,
                    acceleration.flash_attn,
                    acceleration.gpu_device,
                );

                // PERFORMANCE: Suppress verbose C library logs during model loading
                // This hides the excessive Metal/GGML initialization logs in release builds
                let ctx = {
                    // let _suppressor = crate::whisper_engine::StderrSuppressor::new();

                    // Load whisper context with hardware-optimized parameters
                    WhisperContext::new_with_params(&model_info.path.to_string_lossy(), context_param)
                        .map_err(|e| anyhow!("Failed to load model {}: {}", model_name, e))?
                    // Suppressor dropped here, stderr restored
                };

                // Update current context and model; the state is created on first use
                *self.current_state.lock().await = None;
                *self.current_context.write().await = Some(ctx);
                *self.current_model.write().await = Some(model_name.to_string());

                // Enhanced acceleration status reporting
                let acceleration_status = acceleration.status_label();

                log::info!("Successfully loaded model: {} with {} (Performance Tier: {:?}, Beam Size: {}, Threads: {:?})",
                          model_name, acceleration_status, hardware_profile.performance_tier,
                          adaptive_config.beam_size, adaptive_config.max_threads);
                Ok(())
            },
            ModelStatus::Missing => {
                Err(anyhow!("Model {} is not downloaded", model_name))
            },
            ModelStatus::Downloading { .. } => {
                Err(anyhow!("Model {} is currently downloading", model_name))
            },
            ModelStatus::Error(ref err) => {
                Err(anyhow!("Model {} has error: {}", model_name, err))
            },
            ModelStatus::Corrupted { .. } => {
                Err(anyhow!("Model {} is corrupted and cannot be loaded", model_name))
            }
        }
    }

    pub async fn unload_model(&self) -> bool  {
        *self.current_state.lock().await = None;
        let mut ctx_guard = self.current_context.write().await;
        let unloaded = ctx_guard.take().is_some();
        if unloaded {
            log::info!("📉Whisper model unloaded");
        }

        let mut model_name_guard = self.current_model.write().await;
        model_name_guard.take();

        unloaded
    }

    pub async fn get_current_model(&self) -> Option<String> {
        self.current_model.read().await.clone()
    }

    pub async fn is_model_loaded(&self) -> bool {
        self.current_context.read().await.is_some()
    }

    // Enhanced function to clean repetitive text patterns and meaningless outputs
    fn clean_repetitive_text(text: &str) -> String {
        if text.is_empty() {
            return String::new();
        }

        // Check for obviously meaningless patterns first
        if Self::is_meaningless_output(text) {
            // Performance optimization: reduce meaningless output logging to debug level
            perf_debug!("Detected meaningless output, returning empty: '{}'", text);
            return String::new();
        }

        let words: Vec<&str> = text.split_whitespace().collect();
        if words.len() < 3 {
            return text.to_string();
        }

        // Enhanced repetition detection with sliding window
        let cleaned_words = Self::remove_word_repetitions(&words);

        // Remove phrase repetitions with more sophisticated detection
        let cleaned_words = Self::remove_phrase_repetitions(&cleaned_words);

        // Check for overall repetition ratio
        let final_text = cleaned_words.join(" ");
        if Self::calculate_repetition_ratio(&final_text) > 0.7 {
            // Performance optimization: reduce repetition ratio logging to debug level
            perf_debug!("High repetition ratio detected, filtering out: '{}'", final_text);
            return String::new();
        }

        final_text
    }

    // Check for obviously meaningless patterns
    fn is_meaningless_output(text: &str) -> bool {
        let text_lower = text.to_lowercase();

        // Check for common meaningless patterns
        let meaningless_patterns = [
            "thank you for watching",
            "thanks for watching",
            "like and subscribe",
            "music playing",
            "applause",
            "laughter",
            "um um um",
            "uh uh uh",
            "ah ah ah",
        ];

        for pattern in &meaningless_patterns {
            if text_lower.contains(pattern) {
                return true;
            }
        }

        // Check if text is mostly the same character or very short repetitive patterns
        let unique_chars: HashSet<char> = text.chars().collect();
        if unique_chars.len() <= 3 && text.len() > 10 {
            return true;
        }

        false
    }

    // Enhanced word repetition removal
    fn remove_word_repetitions<'a>(words: &'a [&'a str]) -> Vec<&'a str> {
        let mut cleaned_words = Vec::new();
        let mut i = 0;

        while i < words.len() {
            let current_word = words[i];
            let mut repeat_count = 1;

            // Count consecutive repetitions of the same word
            while i + repeat_count < words.len() && words[i + repeat_count] == current_word {
                repeat_count += 1;
            }

            // Be more aggressive: if word is repeated 2+ times, only keep one instance
            if repeat_count >= 2 {
                cleaned_words.push(current_word);
                i += repeat_count;
            } else {
                cleaned_words.push(current_word);
                i += 1;
            }
        }

        cleaned_words
    }

    // Enhanced phrase repetition removal with variable length detection
    fn remove_phrase_repetitions<'a>(words: &'a [&'a str]) -> Vec<&'a str> {
        if words.len() < 4 {
            return words.to_vec();
        }

        let mut final_words = Vec::new();
        let mut i = 0;

        while i < words.len() {
            let mut phrase_found = false;

            // Check for 2-word to 5-word phrase repetitions
            for phrase_len in 2..=std::cmp::min(5, (words.len() - i) / 2) {
                if i + phrase_len * 2 <= words.len() {
                    let phrase1 = &words[i..i + phrase_len];
                    let phrase2 = &words[i + phrase_len..i + phrase_len * 2];

                    if phrase1 == phrase2 {
                        // Add the phrase once and skip the repetition
                        final_words.extend_from_slice(phrase1);
                        i += phrase_len * 2;
                        phrase_found = true;
                        break;
                    }
                }
            }

            if !phrase_found {
                final_words.push(words[i]);
                i += 1;
            }
        }

        final_words
    }

    // Calculate repetition ratio in text
    fn calculate_repetition_ratio(text: &str) -> f32 {
        let words: Vec<&str> = text.split_whitespace().collect();
        if words.len() < 4 {
            return 0.0;
        }

        let mut word_counts = HashMap::new();
        for word in &words {
            *word_counts.entry(word.to_lowercase()).or_insert(0) += 1;
        }

        let total_words = words.len() as f32;
        let repeated_words: usize = word_counts.values().map(|&count| if count > 1 { count - 1 } else { 0 }).sum();

        repeated_words as f32 / total_words
    }

    /// Decoding settings shared by every transcription call, tuned for speed on meeting segments:
    /// the hardware tier's beam width and thread count, a deterministic first pass (whisper.cpp
    /// retries at higher temperature only when a segment fails its entropy/log-probability checks),
    /// no prompt carry-over between segments (it makes fine-tunes invent text on long recordings),
    /// and no token timestamps (segment times come from VAD).
    fn decoding_params(language: Option<&str>) -> FullParams<'_, 'static> {
        let config = crate::audio::HardwareProfile::detect().get_whisper_config();
        let mut params = if config.beam_size > 1 {
            FullParams::new(SamplingStrategy::BeamSearch { beam_size: config.beam_size as i32, patience: 1.0 })
        } else {
            FullParams::new(SamplingStrategy::Greedy { best_of: 1 })
        };

        // "auto"/None detects the language, "auto-translate" also translates to English,
        // anything else is a spoken-language setting ("gsw" decodes with the German token).
        let (language_code, should_translate) = match language {
            Some("auto") | None => (None, false),
            Some("auto-translate") => (None, true),
            Some(lang) => (Some(crate::config::whisper_language(lang)), false),
        };
        params.set_language(language_code);
        params.set_translate(should_translate);

        // CRITICAL: Disable timestamp tokens to prevent whisper.cpp chunking heuristics
        // The "single timestamp ending - skip entire chunk" optimization incorrectly discards
        // complete, valid transcriptions. Disabling timestamps forces whisper to return ALL text.
        params.set_no_timestamps(true);
        params.set_token_timestamps(false);
        params.set_no_context(true);

        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);

        params.set_suppress_blank(true);
        params.set_suppress_non_speech_tokens(true);
        params.set_temperature(0.0);
        params.set_temperature_inc(0.2);
        params.set_max_initial_ts(1.0);
        params.set_entropy_thold(2.4);
        params.set_logprob_thold(-1.0);
        // 0.55 prevents hallucinations while preserving quiet speech (0.75 rejected valid speech)
        params.set_no_speech_thold(0.55);
        params.set_single_segment(false);

        if let Some(max_threads) = config.max_threads {
            params.set_n_threads(max_threads.max(1).min(i32::MAX as usize) as i32);
        }
        params
    }

    /// Runs whisper on one segment and returns its text segments.
    async fn run_whisper(&self, audio_data: &[f32], language: Option<&str>) -> Result<Vec<String>> {
        let ctx_lock = self.current_context.read().await;
        let ctx = ctx_lock.as_ref()
            .ok_or_else(|| anyhow!("No model loaded. Please load a model first."))?;
        let mut state_lock = self.current_state.lock().await;
        if state_lock.is_none() {
            *state_lock = Some(ctx.create_state()?);
        }
        let state = state_lock.as_mut().unwrap();
        state.full(Self::decoding_params(language), audio_data)?;
        let segments = (0..state.full_n_segments()?)
            .filter_map(|i| state.full_get_segment_text_lossy(i).ok())
            .collect();
        Ok(segments)
    }

    /// Transcribe one segment and return (text, confidence, is_partial)
    pub async fn transcribe_audio_with_confidence(&self, audio_data: Vec<f32>, language: Option<String>) -> Result<(String, f32, bool)> {
        let duration_seconds = audio_data.len() as f64 / 16000.0;
        let is_partial = duration_seconds < 15.0; // Consider chunks under 15s as partial
        let segments = self.run_whisper(&audio_data, language.as_deref()).await?;

        let mut result = String::new();
        let mut total_confidence = 0.0;
        let mut segment_count = 0;

        for segment_text in segments {
            // Calculate confidence based on segment length and duration (simplified approach)
            let segment_length = segment_text.len() as f32;
            let segment_confidence = if segment_length > 0.0 {
                (segment_length / 100.0).min(0.9) + 0.1 // 0.1 to 1.0 confidence based on text length
            } else {
                0.1
            };
            total_confidence += segment_confidence;
            segment_count += 1;

            let cleaned_text = segment_text.trim();
            if !cleaned_text.is_empty() {
                if !result.is_empty() {
                    result.push(' ');
                }
                result.push_str(cleaned_text);
            }
        }

        let final_result = result.trim().to_string();
        let cleaned_result = Self::clean_repetitive_text(&final_result);

        let avg_confidence = if segment_count > 0 {
            total_confidence / segment_count as f32
        } else {
            0.0
        };

        Ok((cleaned_result, avg_confidence, is_partial))
    }

    pub async fn transcribe_audio(&self, audio_data: Vec<f32>, language: Option<String>) -> Result<String> {
        let duration_seconds = audio_data.len() as f64 / 16000.0; // Assuming 16kHz
        let is_short_audio = duration_seconds < 1.0;

        // Smart logging based on audio duration and previous states
        let mut should_log_transcription = true;
        let mut should_log_short_warning = false;

        if is_short_audio {
            let last_was_short = *self.last_transcription_was_short.read().await;
            let warning_logged = *self.short_audio_warning_logged.read().await;

            if !warning_logged {
                should_log_short_warning = true;
                *self.short_audio_warning_logged.write().await = true;
            }

            // Only log transcription start if it's the first short audio or previous wasn't short
            should_log_transcription = !last_was_short;

            *self.last_transcription_was_short.write().await = true;
        } else {
            let last_was_short = *self.last_transcription_was_short.read().await;

            // Always log when transitioning from short to normal audio
            if last_was_short {
                log::info!("Audio duration normalized, resuming transcription");
                *self.short_audio_warning_logged.write().await = false;
            }

            *self.last_transcription_was_short.write().await = false;
        }

        if should_log_short_warning {
            log::warn!("Audio duration is short ({:.1}s < 1.0s). Consider padding the input audio with silence. Further short audio warnings will be suppressed.", duration_seconds);
        }

        // Performance optimization: reduce transcription start logging frequency
        let transcription_count = {
            let mut count = self.transcription_count.write().await;
            *count += 1;
            *count
        };

        // Only log every 10th transcription or significant audio (>10s) to reduce I/O overhead
        if should_log_transcription && (transcription_count % 10 == 0 || duration_seconds > 10.0) {
            log::info!("Starting transcription #{} of {} samples ({:.1}s duration)",
                      transcription_count, audio_data.len(), duration_seconds);
        }
        let segments = self.run_whisper(&audio_data, language.as_deref()).await?;
        let num_segments = segments.len();

        // Performance optimization: reduce segment completion logging
        // Only log for significant transcriptions to avoid I/O overhead
        if (should_log_transcription || num_segments > 0) && (num_segments > 3 || duration_seconds > 5.0) {
            perf_debug!("Transcription #{} completed with {} segments ({:.1}s)", transcription_count, num_segments, duration_seconds);
        }
        let mut result = String::new();

        for segment_text in segments {
            // Only log segments for very long audio (>30s) to avoid I/O overhead
            if duration_seconds > 30.0 {
                perf_trace!("Segment: '{}'", segment_text);
            }

            // Clean and append segment text
            let cleaned_text = segment_text.trim();
            if !cleaned_text.is_empty() {
                if !result.is_empty() {
                    result.push(' ');
                }
                result.push_str(cleaned_text);
            }
        }

        let final_result = result.trim().to_string();

        // Check for repetition loops and clean them up
        let cleaned_result = Self::clean_repetitive_text(&final_result);

        // Performance optimization: smart logging for transcription results
        if cleaned_result.is_empty() {
            // Only log empty results occasionally to reduce spam
            if should_log_transcription && transcription_count % 20 == 0 {
                perf_debug!("Transcription #{} result is empty - no speech detected", transcription_count);
            }
        } else {
            if cleaned_result != final_result {
                log::info!("Cleaned repetitive transcription #{}: '{}' -> '{}'", transcription_count, final_result, cleaned_result);
            }
            // Reduce successful transcription logging frequency
            // Only log every 5th result or significant results (>50 chars) to reduce I/O overhead
            if transcription_count % 5 == 0 || cleaned_result.len() > 50 || duration_seconds > 10.0 {
                log::info!("Transcription #{} result: '{}'", transcription_count, cleaned_result);
            } else {
                perf_debug!("Transcription #{} result: '{}'", transcription_count, cleaned_result);
            }
        }

        Ok(cleaned_result)
    }

    pub async fn get_models_directory(&self) -> PathBuf {
        self.models_dir.clone()
    }

    /// Validate if a model file is a valid GGML file by checking its header
    async fn validate_model_file(&self, model_path: &PathBuf) -> Result<()> {
        use tokio::io::AsyncReadExt;

        let mut file = fs::File::open(model_path).await
            .map_err(|e| anyhow!("Failed to open model file: {}", e))?;

        // Read the first 8 bytes to check for GGML magic number
        let mut buffer = [0u8; 8];
        file.read_exact(&mut buffer).await
            .map_err(|e| anyhow!("Failed to read model file header: {}", e))?;

        // Check for GGML magic number (various versions and endianness)
        if buffer.starts_with(b"ggml") || buffer.starts_with(b"GGUF") || buffer.starts_with(b"ggmf") ||
           buffer.starts_with(b"lmgg") || buffer.starts_with(b"FUGU") || buffer.starts_with(b"fmgg") {
            Ok(())
        } else {
            Err(anyhow!("Invalid model file: missing GGML/GGUF magic number. Found: {:?}",
                       String::from_utf8_lossy(&buffer[..4])))
        }
    }

    pub async fn delete_model(&self, model_name: &str) -> Result<String> {
        log::info!("Attempting to delete model: {}", model_name);

        // Get model info to find the file path
        let model_info = {
            let models = self.available_models.read().await;
            models.get(model_name).cloned()
        };

        let model_info = model_info.ok_or_else(|| anyhow!("Model '{}' not found", model_name))?;

        // Check if model is corrupted before allowing deletion
        log::info!("Model '{}' has status: {:?}", model_name, model_info.status);
        match &model_info.status {
            ModelStatus::Corrupted { file_size, expected_min_size } => {
                log::info!("Deleting corrupted model '{}' (file size: {} bytes, expected min: {} bytes)",
                          model_name, file_size, expected_min_size);

                // Delete the file
                if model_info.path.exists() {
                    fs::remove_file(&model_info.path).await
                        .map_err(|e| anyhow!("Failed to delete file '{}': {}", model_info.path.display(), e))?;
                    log::info!("Successfully deleted corrupted file: {}", model_info.path.display());
                } else {
                    log::warn!("File '{}' does not exist, nothing to delete", model_info.path.display());
                }

                // Update model status to Missing
                {
                    let mut models = self.available_models.write().await;
                    if let Some(model) = models.get_mut(model_name) {
                        model.status = ModelStatus::Missing;
                    }
                }

                Ok(format!("Successfully deleted corrupted model '{}'", model_name))
            }
            ModelStatus::Available => {
                // Allow deletion of available models for testing/cleanup
                log::info!("Deleting available model '{}' (for cleanup)", model_name);

                if model_info.path.exists() {
                    fs::remove_file(&model_info.path).await
                        .map_err(|e| anyhow!("Failed to delete file '{}': {}", model_info.path.display(), e))?;
                    log::info!("Successfully deleted available model file: {}", model_info.path.display());
                } else {
                    log::warn!("File '{}' does not exist, nothing to delete", model_info.path.display());
                }

                // Update model status to Missing
                {
                    let mut models = self.available_models.write().await;
                    if let Some(model) = models.get_mut(model_name) {
                        model.status = ModelStatus::Missing;
                    }
                }

                Ok(format!("Successfully deleted model '{}'", model_name))
            }
            _ => {
                Err(anyhow!("Can only delete corrupted or available models. Model '{}' has status: {:?}", model_name, model_info.status))
            }
        }
    }

    pub async fn download_model(&self, model_name: &str, progress_callback: Option<Box<dyn Fn(u8) + Send + Sync>>) -> Result<()> {
        log::info!("Starting download for model: {}", model_name);

        // Check and register in one step so two clicks cannot start two downloads
        if !self.active_downloads.write().await.insert(model_name.to_string()) {
            log::warn!("Download already in progress for model: {}", model_name);
            return Err(anyhow!("Download already in progress for model: {}", model_name));
        }

        // Clear any previous cancellation flag for this model
        *self.cancel_download_flag.write().await = None;

        let result = self.download_model_files(model_name, progress_callback.as_deref()).await;
        self.active_downloads.write().await.remove(model_name);
        if result.is_err() {
            for path in Self::partial_files(&self.models_dir, model_name) {
                let _ = fs::remove_file(path).await;
            }
        }
        result
    }

    /// Temporary files a download writes before the model file appears.
    fn partial_files(models_dir: &std::path::Path, model_name: &str) -> [PathBuf; 2] {
        [
            models_dir.join(format!("ggml-{}.safetensors.part", model_name)),
            models_dir.join(format!("ggml-{}.bin.part", model_name)),
        ]
    }

    async fn download_model_files(&self, model_name: &str, progress_callback: Option<&(dyn Fn(u8) + Send + Sync)>) -> Result<()> {
        // Generate correct filename - all models follow ggml-{model_name}.bin pattern
        let filename = format!("ggml-{}.bin", model_name);
        let file_path = self.models_dir.join(&filename);
        log::info!("Downloading to file path: {}", file_path.display());

        // Create models directory if it doesn't exist
        if !self.models_dir.exists() {
            fs::create_dir_all(&self.models_dir).await
                .map_err(|e| anyhow!("Failed to create models directory: {}", e))?;
        }

        self.report_progress(model_name, 0, progress_callback).await;
        let client = Client::new();

        if model_name == SWISS_GERMAN_WHISPER_MODEL {
            // No whisper.cpp build of this checkpoint is published: download the original
            // weights and convert them to q5_0 locally (about 15 s), then drop the download.
            let source = &SWISS_GERMAN_CHECKPOINT;
            let reference = Self::fetch_reference_header(&client, source.reference_url).await?;
            let [checkpoint, converted] = Self::partial_files(&self.models_dir, model_name);
            self.stream_to_file(&client, model_name, source.checkpoint_url, &checkpoint, Some(source.checkpoint_sha256), (0, 95), progress_callback).await?;

            log::info!("Converting {} to whisper.cpp q5_0", model_name);
            let progress = Arc::new(std::sync::atomic::AtomicU8::new(95));
            let (input, output, step) = (checkpoint.clone(), converted.clone(), progress.clone());
            let mut conversion = tokio::task::spawn_blocking(move || {
                super::hf_convert::convert(&input, &reference, &output, true,
                    &mut |done| step.store(95 + (done * 4.0) as u8, std::sync::atomic::Ordering::Relaxed), &|| true)
            });
            let converted_ok = loop {
                tokio::select! {
                    result = &mut conversion => break result.map_err(|e| anyhow!("Conversion task failed: {}", e))?,
                    _ = tokio::time::sleep(std::time::Duration::from_secs(1)) => {
                        self.report_progress(model_name, progress.load(std::sync::atomic::Ordering::Relaxed), progress_callback).await;
                    }
                }
            };
            converted_ok.map_err(|e| anyhow!("Failed to convert model: {}", e))?;
            if self.is_cancelled(model_name).await {
                return Err(anyhow!("Download cancelled by user"));
            }
            fs::rename(&converted, &file_path).await
                .map_err(|e| anyhow!("Failed to save converted model: {}", e))?;
            let _ = fs::remove_file(&checkpoint).await;
        } else {
            let model_url = Self::model_url(model_name)?;
            log::info!("Model URL for {}: {}", model_name, model_url);
            let [_, partial] = Self::partial_files(&self.models_dir, model_name);
            self.stream_to_file(&client, model_name, &model_url, &partial, None, (0, 100), progress_callback).await?;
            fs::rename(&partial, &file_path).await
                .map_err(|e| anyhow!("Failed to save model: {}", e))?;
        }

        // Ensure 100% progress is always reported
        self.report_progress(model_name, 100, progress_callback).await;
        log::info!("Download completed for model: {}", model_name);

        // Update model status to available
        let mut models = self.available_models.write().await;
        if let Some(model_info) = models.get_mut(model_name) {
            model_info.status = ModelStatus::Available;
            model_info.path = file_path;
        }
        Ok(())
    }

    /// Official ggerganov/whisper.cpp model URLs from Hugging Face
    fn model_url(model_name: &str) -> Result<String> {
        const MODELS: [&str; 12] = [
            "tiny", "base", "small", "medium", "large-v3-turbo", "large-v3",
            "tiny-q5_1", "base-q5_1", "small-q5_1", "medium-q5_0", "large-v3-turbo-q5_0", "large-v3-q5_0",
        ];
        if !MODELS.contains(&model_name) {
            return Err(anyhow!("Unsupported model: {}", model_name));
        }
        Ok(format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{}.bin", model_name))
    }

    /// The header, mel filters and vocabulary of a whisper.cpp model (well under 1 MiB).
    async fn fetch_reference_header(client: &Client, url: &str) -> Result<super::hf_convert::ReferenceHeader> {
        let response = client.get(url).header(reqwest::header::RANGE, "bytes=0-1048575").send().await
            .and_then(|response| response.error_for_status())
            .map_err(|e| anyhow!("Failed to download model header: {}", e))?;
        let bytes = response.bytes().await.map_err(|e| anyhow!("Failed to download model header: {}", e))?;
        super::hf_convert::ReferenceHeader::parse(&bytes)
    }

    async fn is_cancelled(&self, model_name: &str) -> bool {
        self.cancel_download_flag.read().await.as_deref() == Some(model_name)
    }

    async fn report_progress(&self, model_name: &str, progress: u8, callback: Option<&(dyn Fn(u8) + Send + Sync)>) {
        if let Some(model_info) = self.available_models.write().await.get_mut(model_name) {
            model_info.status = ModelStatus::Downloading { progress };
        }
        if let Some(callback) = callback {
            callback(progress);
        }
    }

    /// Streams `url` into `path`, reporting progress mapped into `span` and checking the SHA-256 when given.
    async fn stream_to_file(
        &self,
        client: &Client,
        model_name: &str,
        url: &str,
        path: &PathBuf,
        sha256: Option<&str>,
        span: (u8, u8),
        progress_callback: Option<&(dyn Fn(u8) + Send + Sync)>,
    ) -> Result<()> {
        use futures_util::StreamExt;
        use sha2::{Digest, Sha256};

        log::info!("Sending GET request to: {}", url);
        let response = client.get(url).send().await
            .map_err(|e| anyhow!("Failed to start download: {}", e))?;
        if !response.status().is_success() {
            return Err(anyhow!("Download failed with status: {}", response.status()));
        }

        let total_size = response.content_length().unwrap_or(0);
        log::info!("Response successful, content length: {} bytes ({:.1} MB)", total_size, total_size as f64 / (1024.0 * 1024.0));
        if total_size == 0 {
            log::warn!("Content length is 0 or unknown - download may not show accurate progress");
        }

        let mut file = fs::File::create(path).await
            .map_err(|e| anyhow!("Failed to create file: {}", e))?;
        let mut hasher = sha256.map(|_| Sha256::new());
        let mut stream = response.bytes_stream();
        let mut downloaded = 0u64;
        let mut last_progress_report = span.0;
        let mut last_report_time = std::time::Instant::now();

        while let Some(chunk_result) = stream.next().await {
            if self.is_cancelled(model_name).await {
                log::info!("Download cancelled for {}", model_name);
                return Err(anyhow!("Download cancelled by user"));
            }

            let chunk = chunk_result.map_err(|e| anyhow!("Failed to read chunk: {}", e))?;
            file.write_all(&chunk).await
                .map_err(|e| anyhow!("Failed to write chunk to file: {}", e))?;
            if let Some(hasher) = hasher.as_mut() {
                hasher.update(&chunk);
            }
            downloaded += chunk.len() as u64;

            let fraction = if total_size > 0 { downloaded as f64 / total_size as f64 } else { 0.0 };
            let progress = span.0 + (fraction.min(1.0) * (span.1 - span.0) as f64) as u8;

            // Report progress every 1% or every 2 seconds for better UI responsiveness
            if progress > last_progress_report || last_report_time.elapsed().as_secs() >= 2 {
                log::info!("Download progress: {}% ({:.1} MB / {:.1} MB)", progress,
                    downloaded as f64 / (1024.0 * 1024.0), total_size as f64 / (1024.0 * 1024.0));
                self.report_progress(model_name, progress, progress_callback).await;
                last_progress_report = progress;
                last_report_time = std::time::Instant::now();
            }
        }

        file.flush().await.map_err(|e| anyhow!("Failed to flush file: {}", e))?;
        log::info!("Streaming download completed: {} bytes", downloaded);

        if let (Some(expected), Some(hasher)) = (sha256, hasher) {
            let actual: String = hasher.finalize().iter().map(|byte| format!("{:02x}", byte)).collect();
            if actual != expected {
                return Err(anyhow!("Downloaded file is damaged (checksum mismatch); please retry"));
            }
        }
        Ok(())
    }

    pub async fn cancel_download(&self, model_name: &str) -> Result<()> {
        log::info!("Cancelling download for model: {}", model_name);

        // Set cancellation flag to interrupt the download loop; it removes its own partial files,
        // and model files only appear once a download is complete
        *self.cancel_download_flag.write().await = Some(model_name.to_string());

        // Update model status to Missing (so it can be retried)
        if let Some(model_info) = self.available_models.write().await.get_mut(model_name) {
            model_info.status = ModelStatus::Missing;
        }

        Ok(())
    }
}
