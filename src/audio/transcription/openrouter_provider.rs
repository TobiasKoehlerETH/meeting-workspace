use super::provider::{TranscriptResult, TranscriptionError, TranscriptionProvider};
use async_trait::async_trait;
use std::time::Duration;

pub const DEFAULT_MODEL: &str = "openai/whisper-large-v3-turbo";

pub fn validate_settings(api_key: &str, model: &str) -> Result<(), String> {
    if api_key.trim().is_empty() { return Err("Enter an OpenRouter API key in Settings > Transcription.".into()); }
    if model.trim().is_empty() { return Err("Select an OpenRouter speech model in Settings > Transcription.".into()); }
    Ok(())
}

#[tauri::command]
pub async fn get_openrouter_transcription_models() -> Result<Vec<serde_json::Value>, String> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(20)).build()
        .map_err(|_| "Cannot initialize the model connection.")?;
    let response = client.get("https://openrouter.ai/api/v1/models?output_modalities=transcription")
        .send().await.map_err(|_| "Cannot load OpenRouter speech models.")?
        .error_for_status().map_err(|_| "OpenRouter could not load speech models.")?;
    let catalog: serde_json::Value = response.json().await.map_err(|_| "Invalid speech model list.")?;
    Ok(catalog.get("data").and_then(|value| value.as_array())
        .ok_or("OpenRouter returned no speech model list.")?.iter()
        .filter_map(|model| Some(serde_json::json!({ "id": model.get("id")?.as_str()?, "name": model.get("name")?.as_str()? })))
        .collect())
}

/// Transcribes the same 16 kHz mono chunks used by the local engines.
pub struct OpenRouterProvider {
    client: reqwest::Client,
    api_key: String,
    model: String,
    endpoint: String,
}

impl OpenRouterProvider {
    pub fn new(api_key: String, model: String) -> Result<Self, String> {
        validate_settings(&api_key, &model)?;
        Ok(Self {
            client: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(15))
                .timeout(Duration::from_secs(75))
                .redirect(reqwest::redirect::Policy::none())
                .build().map_err(|_| "Cannot initialize the transcription connection.")?,
            api_key: api_key.trim().to_owned(),
            model: model.trim().to_owned(),
            endpoint: "https://openrouter.ai/api/v1/audio/transcriptions".into(),
        })
    }
}

fn encode_wav(audio: &[f32]) -> Vec<u8> {
    let data_size = (audio.len() * 2) as u32;
    let mut wav = Vec::with_capacity(44 + data_size as usize);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_size).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes()); // PCM
    wav.extend_from_slice(&1u16.to_le_bytes()); // Mono
    wav.extend_from_slice(&16000u32.to_le_bytes());
    wav.extend_from_slice(&32000u32.to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_size.to_le_bytes());
    for &sample in audio {
        let sample = if sample.is_finite() { sample.clamp(-1.0, 1.0) } else { 0.0 };
        let pcm = (sample * if sample < 0.0 { 32768.0 } else { 32767.0 }) as i16;
        wav.extend_from_slice(&pcm.to_le_bytes());
    }
    wav
}

#[async_trait]
impl TranscriptionProvider for OpenRouterProvider {
    async fn transcribe(&self, audio: Vec<f32>, language: Option<String>) -> Result<TranscriptResult, TranscriptionError> {
        if audio.len() < 1600 {
            return Err(TranscriptionError::AudioTooShort { samples: audio.len(), minimum: 1600 });
        }
        if audio.len() > 16000 * 60 {
            return Err(TranscriptionError::EngineFailed("Audio segment exceeds 60 seconds.".into()));
        }
        let file = reqwest::multipart::Part::bytes(encode_wav(&audio))
            .file_name("audio.wav").mime_str("audio/wav")
            .map_err(|_| TranscriptionError::EngineFailed("Cannot encode the audio segment.".into()))?;
        let mut form = reqwest::multipart::Form::new()
            .text("model", self.model.clone())
            .text("response_format", "json")
            .part("file", file);
        if let Some(language) = language.filter(|value| !value.is_empty() && value != "auto" && value != "auto-translate") {
            form = form.text("language", crate::config::normalize_spoken_language(&language).to_owned());
        }
        let response = self.client.post(&self.endpoint).bearer_auth(&self.api_key)
            .multipart(form).send().await.map_err(|error| {
                TranscriptionError::EngineFailed(if error.is_timeout() {
                    "OpenRouter timed out. Check the connection and try again.".into()
                } else { "Cannot connect to OpenRouter. Check the internet connection.".into() })
            })?;
        if !response.status().is_success() {
            let message = match response.status().as_u16() {
                401 | 403 => "OpenRouter rejected the API key. Update it in Settings > Transcription.",
                402 => "OpenRouter has no available credit. Add credit or use a local model.",
                429 => "OpenRouter rate limit reached. Wait before recording again.",
                400 | 404 => "OpenRouter rejected this speech model or audio format. Select another speech model.",
                _ => "OpenRouter could not transcribe this segment. Try again or use a local model.",
            };
            return Err(TranscriptionError::EngineFailed(message.into()));
        }
        let result: serde_json::Value = response.json().await
            .map_err(|_| TranscriptionError::EngineFailed("OpenRouter returned an invalid response.".into()))?;
        let text = result.get("text").and_then(|value| value.as_str())
            .ok_or_else(|| TranscriptionError::EngineFailed("OpenRouter returned no transcript field.".into()))?;
        Ok(TranscriptResult { text: text.trim().into(), confidence: None, is_partial: false })
    }

    async fn is_model_loaded(&self) -> bool { true }
    async fn get_current_model(&self) -> Option<String> { Some(self.model.clone()) }
    fn provider_name(&self) -> &'static str { "OpenRouter" }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn mock_provider(status: &str, body: &str) -> (OpenRouterProvider, tokio::task::JoinHandle<String>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}/audio/transcriptions", listener.local_addr().unwrap());
        let status = status.to_owned();
        let body = body.to_owned();
        let request = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0u8; 8192];
            loop {
                let count = socket.read(&mut buffer).await.unwrap();
                if count == 0 { break; }
                bytes.extend_from_slice(&buffer[..count]);
                if let Some(header_end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..header_end]);
                    let length: usize = headers.lines().find_map(|line| line.to_lowercase().strip_prefix("content-length:").map(|value| value.trim().parse().unwrap())).unwrap();
                    if bytes.len() >= header_end + 4 + length { break; }
                }
            }
            let response = format!("HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", status, body.len(), body);
            socket.write_all(response.as_bytes()).await.unwrap();
            String::from_utf8_lossy(&bytes).into_owned()
        });
        let mut provider = OpenRouterProvider::new("test-key".into(), DEFAULT_MODEL.into()).unwrap();
        provider.endpoint = endpoint;
        (provider, request)
    }

    #[test]
    fn wav_has_correct_format_and_clips_samples() {
        let wav = encode_wav(&[-2.0, 0.0, 2.0, f32::NAN]);
        assert_eq!(&wav[..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(u32::from_le_bytes(wav[24..28].try_into().unwrap()), 16000);
        assert_eq!(u32::from_le_bytes(wav[40..44].try_into().unwrap()), 8);
        let pcm: Vec<i16> = wav[44..].chunks_exact(2).map(|bytes| i16::from_le_bytes(bytes.try_into().unwrap())).collect();
        assert_eq!(pcm, vec![i16::MIN, 0, i16::MAX, 0]);
    }

    #[tokio::test]
    async fn posts_audio_and_parses_transcript() {
        let (provider, request) = mock_provider("200 OK", r#"{"text":" Test transcript. "}"#).await;
        let result = provider.transcribe(vec![0.1; 3200], Some("gsw".into())).await.unwrap();
        assert_eq!(result.text, "Test transcript.");
        let sent = request.await.unwrap();
        assert!(sent.contains("POST /audio/transcriptions"));
        assert!(sent.to_lowercase().contains("authorization: bearer test-key"));
        assert!(sent.contains(DEFAULT_MODEL));
        assert!(sent.contains("name=\"language\"\r\n\r\nde"));
        assert!(sent.contains("filename=\"audio.wav\""));
        assert!(sent.contains("RIFF"));
    }

    #[tokio::test]
    async fn handles_auth_credit_rate_limit_and_invalid_responses() {
        for (status, body, expected) in [
            ("401 Unauthorized", "{}", "API key"),
            ("402 Payment Required", "{}", "credit"),
            ("429 Too Many Requests", "{}", "rate limit"),
            ("200 OK", "broken-json", "invalid response"),
            ("200 OK", "{}", "no transcript field"),
        ] {
            let (provider, request) = mock_provider(status, body).await;
            let error = provider.transcribe(vec![0.1; 3200], None).await.unwrap_err().to_string();
            assert!(error.contains(expected), "{}", error);
            assert!(!error.contains("test-key"));
            request.await.unwrap();
        }
    }

    #[tokio::test]
    async fn rejects_missing_settings_and_short_audio_without_a_request() {
        assert!(OpenRouterProvider::new(" ".into(), DEFAULT_MODEL.into()).is_err());
        assert!(OpenRouterProvider::new("test-key".into(), " ".into()).is_err());
        let provider = OpenRouterProvider::new("test-key".into(), DEFAULT_MODEL.into()).unwrap();
        assert!(matches!(provider.transcribe(vec![0.0; 10], None).await, Err(TranscriptionError::AudioTooShort { .. })));
    }
}
