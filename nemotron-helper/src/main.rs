use sherpa_onnx::{OnlineRecognizer, OnlineRecognizerConfig};
use std::io::{self, Read, Write};
use std::path::PathBuf;

fn send(value: serde_json::Value) -> io::Result<()> {
    let mut out = io::stdout().lock();
    writeln!(out, "{}", value)?;
    out.flush()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let directory = PathBuf::from(args.next().ok_or("Missing model directory")?);
    let language = args.next().unwrap_or_else(|| "auto".into());
    let mut config = OnlineRecognizerConfig::default();
    config.model_config.transducer.encoder = Some(directory.join("encoder.int8.onnx").to_string_lossy().into());
    config.model_config.transducer.decoder = Some(directory.join("decoder.int8.onnx").to_string_lossy().into());
    config.model_config.transducer.joiner = Some(directory.join("joiner.int8.onnx").to_string_lossy().into());
    config.model_config.tokens = Some(directory.join("tokens.txt").to_string_lossy().into());
    config.model_config.num_threads = 4;
    config.model_config.provider = Some("cpu".into());
    config.decoding_method = Some("greedy_search".into());
    config.enable_endpoint = true;
    config.rule1_min_trailing_silence = 2.4;
    config.rule2_min_trailing_silence = 0.8;
    config.rule3_min_utterance_length = 30.0;
    let recognizer = OnlineRecognizer::create(&config).ok_or("Cannot load Nemotron streaming model")?;
    let stream = recognizer.create_stream();
    stream.set_option("language", &language);
    send(serde_json::json!({"ready":true}))?;
    let mut stdin = io::stdin().lock();
    loop {
        let mut header = [0u8; 8];
        match stdin.read_exact(&mut header) {
            Ok(()) => {},
            Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => break,
            Err(error) => return Err(error.into()),
        }
        let count = u32::from_le_bytes(header[..4].try_into()?) as usize;
        let rate = u32::from_le_bytes(header[4..].try_into()?) as i32;
        if count > 48000 * 10 { return Err("Audio message exceeds ten seconds".into()); }
        if count == 0 {
            stream.accept_waveform(16000, &vec![0.0; 16000]);
            stream.input_finished();
        } else {
            let mut bytes = vec![0u8; count * 4];
            stdin.read_exact(&mut bytes)?;
            let audio: Vec<f32> = bytes.chunks_exact(4).map(|sample| f32::from_le_bytes(sample.try_into().unwrap())).collect();
            stream.accept_waveform(rate, &audio);
        }
        while recognizer.is_ready(&stream) { recognizer.decode(&stream); }
        let final_segment = count == 0 || recognizer.is_endpoint(&stream);
        let result = recognizer.get_result(&stream).ok_or("Cannot read Nemotron transcript")?;
        send(serde_json::json!({"text":result.text,"final":final_segment}))?;
        if count == 0 { break; }
        if final_segment {
            recognizer.reset(&stream);
            stream.set_option("language", &language);
        }
    }
    Ok(())
}
