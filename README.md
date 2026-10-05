# Meeting Workspace

A desktop workspace for recording meetings, local transcription, notes, and AI summaries.

- Capture microphone and system audio.
- Transcribe with local Whisper or Parakeet models.
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
pnpm tauri dev
```

## Windows installer

See [BUILD-WINDOWS.md](BUILD-WINDOWS.md) for prerequisites and the build command.
The unsigned Windows x64 installer includes the audio helper, local summary helper,
templates, and required runtime DLLs.

## License

MIT. Required copyright and permission notices are retained in [LICENSE](LICENSE).
Third-party libraries and model weights retain their own licenses.
