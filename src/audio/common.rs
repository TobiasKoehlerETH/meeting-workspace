use crate::api::TranscriptSegment;
use anyhow::Result;
use log::info;
use once_cell::sync::Lazy;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};
use uuid::Uuid;

static ENGINE_LIFECYCLE_LOCK: Lazy<Arc<AsyncMutex<()>>> =
    Lazy::new(|| Arc::new(AsyncMutex::new(())));

pub(crate) async fn acquire_engine_lifecycle_lock() -> OwnedMutexGuard<()> {
    ENGINE_LIFECYCLE_LOCK.clone().lock_owned().await
}

/// Unload the transcription engine after a batch job (import or retranscription).
/// Recording does not use speech models, so it does not need to retain them.
pub(crate) async fn unload_engine_after_batch(use_parakeet: bool) {
    let _engine_lifecycle_guard = acquire_engine_lifecycle_lock().await;

    if use_parakeet {
        use crate::parakeet_engine::commands::PARAKEET_ENGINE;
        let engine = {
            let guard = PARAKEET_ENGINE.lock().unwrap_or_else(|e| e.into_inner());
            guard.as_ref().cloned()
        };
        if let Some(e) = engine {
            e.unload_model().await;
        }
    } else {
        use crate::whisper_engine::commands::WHISPER_ENGINE;
        let engine = {
            let guard = WHISPER_ENGINE.lock().unwrap_or_else(|e| e.into_inner());
            guard.as_ref().cloned()
        };
        if let Some(e) = engine {
            e.unload_model().await;
        }
    }
}

/// Create transcript segments from transcription results.
/// Each tuple is (text, start_ms, end_ms) from VAD timestamps.
pub(crate) fn create_transcript_segments(transcripts: &[(String, f64, f64)]) -> Vec<TranscriptSegment> {
    transcripts
        .iter()
        .map(|(text, start_ms, end_ms)| {
            let start_seconds = start_ms / 1000.0;
            let end_seconds = end_ms / 1000.0;
            let duration = end_seconds - start_seconds;

            TranscriptSegment {
                id: format!("transcript-{}", Uuid::new_v4()),
                text: text.trim().to_string(),
                timestamp: chrono::Utc::now().to_rfc3339(),
                audio_start_time: Some(start_seconds),
                audio_end_time: Some(end_seconds),
                duration: Some(duration),
                speaker: None,
            }
        })
        .collect()
}

/// Write transcripts.json to a meeting folder (atomic write with temp file)
pub(crate) fn write_transcripts_json(folder: &Path, segments: &[TranscriptSegment]) -> Result<()> {
    let transcript_path = folder.join("transcripts.json");
    let temp_path = folder.join(".transcripts.json.tmp");

    let json = serde_json::json!({
        "version": "1.0",
        "last_updated": chrono::Utc::now().to_rfc3339(),
        "total_segments": segments.len(),
        "segments": segments.iter().enumerate().map(|(i, s)| {
            serde_json::json!({
                "id": s.id,
                "text": s.text,
                "timestamp": s.timestamp,
                "audio_start_time": s.audio_start_time,
                "audio_end_time": s.audio_end_time,
                "duration": s.duration,
                "speaker": s.speaker,
                "sequence_id": i
            })
        }).collect::<Vec<_>>()
    });

    let json_string = serde_json::to_string_pretty(&json)?;
    std::fs::write(&temp_path, &json_string)?;
    std::fs::rename(&temp_path, &transcript_path)?;

    info!(
        "Wrote transcripts.json with {} segments to {}",
        segments.len(),
        transcript_path.display()
    );
    Ok(())
}

/// Longest audio passed to Whisper in one call: its encoder always runs on a 30s window.
pub(crate) const MAX_WHISPER_WINDOW_SAMPLES: usize = 30 * 16000;

/// Turn speech pieces into Whisper windows: join consecutive pieces of one speaker into runs
/// (see `pack_speech_segments`), then split each run into the fewest near-equal windows.
/// Each Whisper call has a large fixed encoder cost, so fewer, fuller calls are much faster.
pub(crate) fn whisper_windows(
    segments: Vec<crate::audio::vad::SpeechSegment>,
) -> Vec<crate::audio::vad::SpeechSegment> {
    pack_speech_segments(segments, usize::MAX).iter()
        .flat_map(|run| split_evenly_at_silence(run, MAX_WHISPER_WINDOW_SAMPLES))
        .collect()
}

/// Split a long speech segment into the fewest near-equal chunks of at most ~`max_samples`,
/// moving each cut to the quietest 100ms within 2s of it. Equal chunks avoid a short leftover
/// that would cost a full Whisper pass of its own.
pub(crate) fn split_evenly_at_silence(
    segment: &crate::audio::vad::SpeechSegment,
    max_samples: usize,
) -> Vec<crate::audio::vad::SpeechSegment> {
    const WINDOW: usize = 1600; // 100ms
    const RADIUS: usize = 2 * 16000;
    let total = segment.samples.len();
    // Leave room for the cut to move by RADIUS without exceeding max_samples.
    let chunk_limit = max_samples.saturating_sub(RADIUS).max(WINDOW);
    let count = total.div_ceil(chunk_limit).max(1);
    if count == 1 { return vec![segment.clone()]; }
    let ms_per_sample = (segment.end_timestamp_ms - segment.start_timestamp_ms) / total as f64;
    let mut cuts = vec![0];
    for i in 1..count {
        let target = total * i / count;
        let (from, to) = (target.saturating_sub(RADIUS), (target + RADIUS).min(total - WINDOW));
        let quietest = (from..=to).step_by(160)
            .map(|at| (at, segment.samples[at..at + WINDOW].iter().map(|s| s * s).sum::<f32>()))
            .min_by(|a, b| a.1.total_cmp(&b.1))
            .map_or(target, |(at, _)| at + WINDOW / 2);
        cuts.push(quietest.max(cuts[cuts.len() - 1] + WINDOW));
    }
    cuts.push(total);
    cuts.windows(2).map(|pair| crate::audio::vad::SpeechSegment {
        samples: segment.samples[pair[0]..pair[1]].to_vec(),
        start_timestamp_ms: segment.start_timestamp_ms + pair[0] as f64 * ms_per_sample,
        end_timestamp_ms: segment.start_timestamp_ms + pair[1] as f64 * ms_per_sample,
        confidence: segment.confidence,
        speaker: segment.speaker.clone(),
    }).collect()
}

/// Pack consecutive speech segments into windows of up to `max_samples`.
///
/// Whisper pads every call to a 30-second window, so transcribing many short pieces one by one
/// costs a full encoder pass each. Pieces join the current window when the speaker matches,
/// when either side has no speaker, or when the piece is a short interjection (under 2s).
/// Gaps between pieces shrink to at most 300ms of silence.
pub(crate) fn pack_speech_segments(
    segments: Vec<crate::audio::vad::SpeechSegment>,
    max_samples: usize,
) -> Vec<crate::audio::vad::SpeechSegment> {
    const MAX_GAP: usize = 16000 * 3 / 10;
    const SHORT: usize = 2 * 16000;
    let mut packed: Vec<crate::audio::vad::SpeechSegment> = Vec::new();
    for segment in segments {
        if let Some(last) = packed.last_mut() {
            let gap = (((segment.start_timestamp_ms - last.end_timestamp_ms) * 16.0).max(0.0) as usize).min(MAX_GAP);
            let joins = last.speaker == segment.speaker || last.speaker.is_none() || segment.speaker.is_none()
                || segment.samples.len() < SHORT;
            if joins && last.samples.len() + gap + segment.samples.len() <= max_samples {
                last.samples.extend(std::iter::repeat(0.0).take(gap));
                last.samples.extend_from_slice(&segment.samples);
                last.end_timestamp_ms = segment.end_timestamp_ms;
                last.confidence = last.confidence.min(segment.confidence);
                if last.speaker.is_none() { last.speaker = segment.speaker; }
                continue;
            }
        }
        packed.push(segment);
    }
    packed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_engine_lifecycle_lock_serializes_acquirers() {
        let guard = acquire_engine_lifecycle_lock().await;
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (acquired_tx, mut acquired_rx) = tokio::sync::oneshot::channel();
        let waiter = tokio::spawn(async {
            started_tx.send(()).unwrap();
            let _guard = acquire_engine_lifecycle_lock().await;
            acquired_tx.send(()).unwrap();
        });

        started_rx.await.unwrap();
        assert!(acquired_rx.try_recv().is_err());
        drop(guard);

        acquired_rx.await.unwrap();
        waiter.await.unwrap();
    }

    fn speech(start_ms: f64, seconds: f64, speaker: Option<&str>) -> crate::audio::vad::SpeechSegment {
        crate::audio::vad::SpeechSegment {
            samples: vec![0.1; (seconds * 16000.0) as usize],
            start_timestamp_ms: start_ms,
            end_timestamp_ms: start_ms + seconds * 1000.0,
            confidence: 0.9,
            speaker: speaker.map(str::to_string),
        }
    }

    #[test]
    fn pack_speech_segments_joins_interjections_and_splits_on_speaker_change() {
        let segments = vec![
            speech(0.0, 5.0, Some("Speaker 1")), speech(5000.0, 1.0, None),
            speech(6000.0, 1.0, Some("Speaker 2")), speech(9000.0, 5.0, Some("Speaker 1")),
            speech(14000.0, 6.0, Some("Speaker 2")), speech(20000.0, 25.0, Some("Speaker 2")),
        ];
        let packed = pack_speech_segments(segments, MAX_WHISPER_WINDOW_SAMPLES);
        let spans: Vec<(f64, f64, Option<&str>)> = packed.iter()
            .map(|s| (s.start_timestamp_ms, s.end_timestamp_ms, s.speaker.as_deref())).collect();
        assert_eq!(spans, vec![
            (0.0, 14000.0, Some("Speaker 1")),
            (14000.0, 20000.0, Some("Speaker 2")),
            (20000.0, 45000.0, Some("Speaker 2")),
        ]);
        // 5s + 1s + 1s + 0.3s gap + 5s
        assert_eq!(packed[0].samples.len(), 16000 * 123 / 10);
    }

    #[test]
    fn whisper_windows_balances_a_speaker_run() {
        let pieces = vec![
            speech(0.0, 24.0, Some("Speaker 1")), speech(24000.0, 24.0, None),
            speech(48000.0, 6.0, Some("Speaker 1")), speech(54000.0, 10.0, Some("Speaker 2")),
        ];
        let windows = whisper_windows(pieces);
        let lengths: Vec<f64> = windows.iter().map(|w| w.samples.len() as f64 / 16000.0).collect();
        assert_eq!(lengths.len(), 3, "{lengths:?}");
        assert!(lengths[0] > 25.0 && lengths[1] > 25.0, "{lengths:?}");
        assert_eq!(windows[2].speaker.as_deref(), Some("Speaker 2"));
        assert!(windows.iter().all(|w| w.samples.len() <= MAX_WHISPER_WINDOW_SAMPLES));
    }

    #[test]
    fn split_evenly_at_silence_avoids_a_short_leftover() {
        let mut segment = speech(1000.0, 50.0, None);
        let quiet = 24 * 16000;
        segment.samples[quiet..quiet + 3200].fill(0.0);
        let chunks = split_evenly_at_silence(&segment, MAX_WHISPER_WINDOW_SAMPLES);
        assert_eq!(chunks.len(), 2);
        assert!((chunks[0].samples.len() as i64 - (quiet as i64 + 800)).abs() <= 800);
        assert_eq!(chunks.iter().map(|c| c.samples.len()).sum::<usize>(), segment.samples.len());
        assert_eq!(chunks[1].end_timestamp_ms, 51000.0);
        assert!(chunks.iter().all(|c| c.samples.len() <= MAX_WHISPER_WINDOW_SAMPLES));
        assert_eq!(split_evenly_at_silence(&speech(0.0, 20.0, None), MAX_WHISPER_WINDOW_SAMPLES).len(), 1);
    }
}
