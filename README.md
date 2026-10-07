# Meeting Workspace

Record and save high-quality audio first. Transcribe and summarize locally when you choose.

- Capture microphone and system audio into a lossless `recording.wav`.
- Stop saves audio only. Select the saved meeting and click **Transcribe** to start local speech and speaker detection. No live transcription or automatic inference runs when recording ends.
- **Listen to recording** plays the saved audio inside the app without loading the whole file into JavaScript.
- A progress bar shows decoding, speaker detection, transcription, and saving stages during manual transcription.
- New setups default to quantized Whisper Turbo (`large-v3-turbo-q5_0`), using beam search with five candidates.
- Whisper large-v3 remains available when accuracy matters more than processing time and memory.
- Parakeet remains available as a faster local alternative.
- Local summaries default to Qwen 3.5 4B. Smaller local models remain available for limited memory.
- Set **Settings > Summary > Summary lines** to 1–50 bullet lines (default 10).
  The model may use fewer lines when there are fewer facts. Screen wrapping does not count as a line.
- If Automatic summaries is enabled, a local summary follows your manual Transcribe action. Saving audio alone never generates a summary.
- Audio is saved before inference, so a missing model or failed transcription can be retried from meeting details.

Download the selected models once in Settings. Inference needs no API key or internet connection.
Model downloads and FFmpeg installation use the internet. There is no cloud fallback for recording transcription or summaries.

Select the spoken language for Whisper. Swiss German uses the German language hint for Standard German output.
Accuracy depends on language, microphone quality, overlapping speakers, and model capability; this build does not guarantee perfect transcripts.

## Development

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
pnpm tauri dev
```

See [BUILD-WINDOWS.md](BUILD-WINDOWS.md) for native builds and [PERFORMANCE.md](PERFORMANCE.md) for processing details.

The interface follows the A+P workshop style. Automatic updates and usage telemetry are removed.
Recording controls remain available in the tray menu and main window.

## Local speaker detection

Speaker detection is enabled by default under **Settings > Transcription**. It runs when you click Transcribe, before the speech model loads, using bundled sherpa-onnx CPU inference, quantized pyannote segmentation-3.0, and NVIDIA TitaNet-S embeddings. Audio and voice embeddings are not sent to a service.

Use **Number of speakers = 0** for automatic grouping, or set the known count (1–20). One speaker bypasses the speaker model. Turn detection off to reduce processing time when labels are unnecessary.

The transcript shows **Speaker 1**, **Speaker 2**, and so on. Open **Speaker names** above the transcript to rename a voice within that meeting. Copying the transcript includes these labels; new or regenerated local summaries receive them too. Existing summaries are not rewritten automatically. These models group voices and do not know real identities or Teams account names.

For an existing recording, choose **Transcribe again** to apply the current speaker settings. This replaces earlier labels and names. No additional model download is needed in the Windows package. Keep the `speaker-runtime` folder with the portable executable.

Automatic counts can over-split or merge speakers. A known count can help. Overlapping speech is labelled **Multiple speakers** when detected; it is not separated into clean audio channels. Accuracy on Teams calls, noise, short replies, and Swiss German still needs representative meeting tests.

## Start minimized

Enable **Settings > General > Start minimized** to open in the system tray on the next launch.
Use **Open Main Window** in the tray menu to return. This does not start recording automatically.
The tray tooltip shows recording status, and recording controls remain available in the menu.

For a single launch, use `meeting-workspace.exe --minimized`. Use `--show` to override the saved preference.
If the tray cannot be created, the main window opens so the app remains accessible.

## Discreet launch (stealth mode)

Enable **Settings > General > Discreet launch (stealth mode)**, or launch with
`meeting-workspace.exe --stealth`. The window stays hidden, app notifications are
silent, and the tray tooltip shows only the app name. Tray recording actions do
not bring the window forward. Recording starts only when you choose **Start Recording**.

Use the tray menu to start, pause, resume, or stop recording, and **Open Main Window**
to review transcripts and summaries. Those controls still show recording status.
Operating-system microphone indicators and process listings remain visible; this
mode does not make recording invisible. Use `--show` to override both saved launch
preferences for a new session. If the app is already running, `--show` opens its window.
Tray recording waits for your saved audio-device choices to load. If a device
cannot start, the tray controls recover so you can retry or open Settings.

## License

MIT. Copyright and permission notices remain in [LICENSE](LICENSE).
Third-party libraries and model weights retain their own licenses.
