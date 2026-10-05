# Meeting Workspace

A desktop workspace for recording meetings, local transcription, notes, and AI summaries.

- Capture microphone and system audio.
- Transcribe with local Whisper or Parakeet models, or an OpenRouter API key.
- Select the spoken language, including Swiss German with Standard German output.
- Use local two-stage transcription: Nemotron Streaming during a meeting, then Parakeet after Stop.
- Edit notes and keep them with each meeting.
- Generate summaries with a local model or your selected AI provider.
- Store recordings, transcripts, and notes on your device.

The interface follows the A+P workshop style: red headings and accent rules,
geometric typography, white and gray surfaces, and spacious layouts.

Automatic updates and usage telemetry are removed from this build.
Local models download from their model repositories; FFmpeg comes from independent
FFmpeg distributors. Optional external AI providers receive data when you
configure and use them.

## Development

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm tauri dev
```

## Windows installer

See [BUILD-WINDOWS.md](BUILD-WINDOWS.md) for prerequisites and the build command.
The unsigned Windows x64 installer includes the audio helper, local summary helper,
templates, and required runtime DLLs.

Recording prepares speech detection in the background and keeps local speech models
ready for three minutes after stopping. This reduces preparation work on the next click.
OpenRouter summaries default to Gemini 2.5 Flash Lite and can reuse the transcription key.

## Local two-stage transcription

Choose **Settings > Transcription > Local · Nemotron live + Parakeet final**.
Download both models, choose the spoken language, and enable the mode.
Nemotron receives continuous microphone audio and shows live partial results.
After Stop, Parakeet reads the original `recording.wav` to create the final transcript.
The meeting folder keeps `transcript-live.json`, `transcript-final.json`, and the
lossless original WAV. If the final pass fails, the live transcript remains available.
The speech models run locally; summaries can still use the configured AI provider.

This mode records the microphone only and always saves the original audio.
Parakeet detects the final language automatically. Swiss German dialect accuracy
depends on the models; use Whisper when Standard German output is critical.

## License

MIT. Required copyright and permission notices are retained in [LICENSE](LICENSE).
Third-party libraries and model weights retain their own licenses.
