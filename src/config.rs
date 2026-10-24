/// Application configuration constants
///
/// Centralized definitions for default models and settings.
/// Used across database initialization, import, and retranscription.

/// Default Whisper model for transcription when no preference is configured.
/// This is the recommended balance of accuracy and speed.
pub const DEFAULT_WHISPER_MODEL: &str = "large-v3-turbo-q5_0";

/// Default Parakeet model for transcription when no preference is configured.
/// This is the quantized version optimized for speed.
pub const DEFAULT_PARAKEET_MODEL: &str = "parakeet-tdt-0.6b-v3-int8";

/// Whisper fine-tune for Swiss German speech, written as Standard German.
/// Converted on download from `SWISS_GERMAN_CHECKPOINT` (MIT licence).
pub const SWISS_GERMAN_WHISPER_MODEL: &str = "large-v3-turbo-swiss-german-q5_0";

/// The source checkpoint, pinned to a revision and verified by SHA-256.
pub struct ConvertedWhisperSource {
    pub checkpoint_url: &'static str,
    pub checkpoint_sha256: &'static str,
    /// whisper.cpp file of the same architecture; its header supplies mel filters and vocabulary.
    pub reference_url: &'static str,
}

pub const SWISS_GERMAN_CHECKPOINT: ConvertedWhisperSource = ConvertedWhisperSource {
    checkpoint_url: "https://huggingface.co/gcoli/whisper-large-v3-turbo-swiss-german-mit/resolve/540fb2e7a9135048963c5de9822579c96f8962e5/model.safetensors",
    checkpoint_sha256: "b37f10e1b905e7c6a0a7d3eb7462083b6e12caa71c06e26c83245d33337d246d",
    reference_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
};

/// Whisper's language token for a spoken-language setting.
/// Swiss German has no token of its own; the fine-tune is trained on `de` and writes Standard German.
pub fn whisper_language(language: &str) -> &str {
    match language { "gsw" => "de", other => other }
}

/// Swiss German speech uses the Swiss German model once it is downloaded, whatever engine is chosen:
/// Parakeet and the stock Whisper models do not know the dialects. Other languages keep the choice.
pub fn speech_model_for_language(
    provider: Option<String>,
    model: Option<String>,
    language: Option<&str>,
    swiss_german_ready: bool,
) -> (Option<String>, Option<String>) {
    if language == Some("gsw") && swiss_german_ready {
        (Some("localWhisper".into()), Some(SWISS_GERMAN_WHISPER_MODEL.into()))
    } else {
        (provider, model)
    }
}

#[cfg(test)]
mod language_tests {
    use super::*;

    #[test]
    fn swiss_german_uses_the_german_token() {
        assert_eq!(whisper_language("gsw"), "de");
        for language in ["de", "en", "auto"] {
            assert_eq!(whisper_language(language), language);
        }
    }

    #[test]
    fn swiss_german_switches_to_the_fine_tune_when_downloaded() {
        let parakeet = || (Some("parakeet".to_string()), Some("parakeet-tdt-0.6b-v3-int8".to_string()));
        let swiss = (Some("localWhisper".to_string()), Some(SWISS_GERMAN_WHISPER_MODEL.to_string()));
        let (provider, model) = parakeet();
        assert_eq!(speech_model_for_language(provider, model, Some("gsw"), true), swiss);
        let (provider, model) = parakeet();
        assert_eq!(speech_model_for_language(provider, model, Some("gsw"), false), parakeet());
        let (provider, model) = parakeet();
        assert_eq!(speech_model_for_language(provider, model, Some("de"), true), parakeet());
    }
}

/// Whisper model catalog with metadata for all supported models.
/// Used by both WhisperEngine::discover_models() and discover_models_standalone().
///
/// Format: (name, filename, size_mb, accuracy, speed, description)
pub const WHISPER_MODEL_CATALOG: &[(&str, &str, u32, &str, &str, &str)] = &[
    // Standard f16 models (full precision)
    ("tiny", "ggml-tiny.bin", 74, "Decent", "Very Fast", "Fastest processing, good for real-time use"),
    ("base", "ggml-base.bin", 142, "Good", "Fast", "Good balance of speed and accuracy"),
    ("small", "ggml-small.bin", 466, "Good", "Medium", "Better accuracy, moderate speed"),
    ("medium", "ggml-medium.bin", 1463, "High", "Slow", "High accuracy for professional use"),
    ("large-v3-turbo", "ggml-large-v3-turbo.bin", 1549, "High", "Medium", "Best accuracy with improved speed"),
    ("large-v3", "ggml-large-v3.bin", 2951, "High", "Slow", "Most Accurate, latest large model"),

    // Q5_1 quantized models (balanced speed/accuracy, slightly better quality than Q5_0)
    ("tiny-q5_1", "ggml-tiny-q5_1.bin", 31, "Decent", "Very Fast", "Quantized tiny model, ~50% faster processing"),
    ("base-q5_1", "ggml-base-q5_1.bin", 57, "Good", "Fast", "Quantized base model, good speed/accuracy balance"),
    ("small-q5_1", "ggml-small-q5_1.bin", 181, "Good", "Fast", "Quantized small model, faster than f16 version"),

    // Q5_0 quantized models (balanced speed/accuracy)
    ("medium-q5_0", "ggml-medium-q5_0.bin", 514, "High", "Medium", "Quantized medium model, professional quality"),
    ("large-v3-turbo-q5_0", "ggml-large-v3-turbo-q5_0.bin", 547, "High", "Medium", "Quantized large model, best balance"),
    ("large-v3-q5_0", "ggml-large-v3-q5_0.bin", 1031, "High", "Slow", "Quantized large model, high accuracy"),

    // Converted from Hugging Face on download (see SWISS_GERMAN_CHECKPOINT)
    ("large-v3-turbo-swiss-german-q5_0", "ggml-large-v3-turbo-swiss-german-q5_0.bin", 547, "High", "Medium", "Swiss German fine-tune of Turbo, Standard German text"),
];
