# Local processing and performance

Recording saves audio only. Local processing starts when the user selects a saved meeting and clicks Transcribe. No comparative model benchmark is claimed. Earlier verification sections below describe historical builds.

## Recording

Capture mixes microphone and system audio directly into a lossless WAV writer.
It does not load a speech model, run voice detection, create live transcript events, or animate incoming text.
The mixer drains queued audio and its final partial window at Stop. Audio remains available after inference failures.
Saving is mandatory because later transcription uses the recording. Stop does not invoke any speech, speaker, or summary model.

## Transcription

New setups use quantized Whisper Turbo, with beam size 5 and deterministic initial decoding.
Saved model choices are retained. Whisper's hardware thread limit is applied to inference.
Parakeet remains selectable for faster processing. Existing acceleration features remain available.
Speech detection and segmentation run after capture. The speech model is unloaded after the batch job, freeing memory before summary generation.
The batch path consumes decoded audio rather than cloning the full mono recording. It moves speech buffers into the model and releases completed segments as it goes. This removes a second retained copy of speech audio and the per-segment inference copy in both recording transcription and audio import. Silence splitting, sample normalization, and timestamps are preserved.

## Summaries

Qwen 3.5 4B runs through the built-in local helper. Smaller models remain selectable.
The saved summary length is 1–50 bullet lines, default 10. Output is validated and a malformed base summary is retried once.
Long transcripts use overlapping chunks and bounded reduction passes. The final summary pass combines those chunks directly, avoiding a redundant synthesis pass. Failed chunks fail the job instead of silently producing incomplete summaries.
Chunk boundaries preserve all source text. Byte offsets are calculated once instead of repeatedly scanning prefixes.
Model context reserves space for the generated output; the helper rejects oversized prompts instead of silently truncating them.
The helper sizes its inference context to the actual prompt plus output budget, instead of allocating the model's full context for every short meeting. Oversized requests are rejected before context allocation.

## Cleanup and checks

Removed the Nemotron helper, live transcription worker/provider modules, live buffering and animation code, duplicate transcript view, unused command widget/service, and obsolete benchmark.
Removed completed one-off refactoring scripts and the obsolete tray update action. The older preferences dialog now reuses the local summary settings.
Removed the unused FFmpeg-style mixer and per-device recording channels; the active mixer is the only path to the WAV writer. Tray Stop shares one handler, and recording-stop listeners are released even when registration finishes after a page closes.
Removed the unused text post-processor, asynchronous logger, metrics batcher, and buffer pool. Recording state no longer allocates the unused pool. Startup no longer reads unused cloud-provider credentials or fetches an unused Ollama model list. Unused native test dependencies and Cargo settings that the workspace ignored were removed.
Legacy meeting data, recovery support, migration history, model files, and third-party licenses are retained.

Discreet launch keeps the window hidden and silences app notifications for the session. Tray starts wait for saved audio-device preferences, and failed starts restore the tray controls. Closing without a working tray exits normally instead of hiding an inaccessible app. Operating-system microphone indicators remain outside this mode's control.

```powershell
pnpm check
pnpm test
pnpm build
node scripts/audit-ui-actions.cjs
python -m unittest discover -s tests -p 'test_*.py'
.\scripts\build-windows.ps1 -TestUnit
.\scripts\build-windows.ps1 -TestHelper
```

Native tests cover the mixer tail, lossless WAV samples, transcript chunk coverage, and summary output validation.
Real microphone/system capture, GPU inference, and accuracy on representative meeting recordings require hardware tests.

## Earlier recorded checks on 6 October 2026

- 198 native unit tests passed; four opt-in tests were skipped in that run.
- Ten frontend tests, four summary-helper tests, the database index check, and the production frontend build passed.
- The opt-in Parakeet check transcribed the synthetic speech fixture as “This is a test of meeting transcription.” in 4.87 seconds including model loading.
- The opt-in Qwen 3.5 4B check produced one and three bullets for the corresponding requested limits. The two requests took 18.97 and 13.69 seconds on the CPU build.
- The short summary request allocated 4,352 context tokens rather than the full 32,768. This is a context-capacity reduction, not a measured total memory or speed improvement.

These synthetic checks establish functionality on this machine, not a ranking of model efficiency or meeting-transcription accuracy.

## Verification after the launch and cleanup fixes

- TypeScript checking, eleven frontend tests, the production frontend build, and the database index test passed.
- The UI command audit found 173 invocations with no missing registered commands.
- 195 native unit tests passed; four opt-in tests were excluded from that run. Three tests disappeared with the unused buffer pool and text post-processor.
- All four summary-helper tests passed.
- The separate Parakeet inference check correctly transcribed the generated speech fixture in 2.88 seconds including model loading.
- The separate Qwen 3.5 4B check returned one and three bullets for the requested limits in 15.44 and 12.28 seconds, respectively, on the CPU build.
- The short summary request allocated 4,352 of 32,768 context tokens.

The build script now checks prerequisites, stages the helper for native tests, and avoids replacing an unchanged helper binary. Native desktop visibility, microphone capture, GPU acceleration, and real-meeting quality still require manual hardware validation.

## Verification after removing batch audio copies

All 196 native unit tests passed, including allocation reuse and invalid-sample normalization; four opt-in tests were skipped. The separate local Parakeet smoke test transcribed the synthetic phrase correctly in 2.06 seconds including model loading. The production frontend and Windows release executable compiled successfully. These timings are smoke checks, not a controlled before/after performance comparison.

## Local speaker labels

The packaged Windows app now includes sherpa-onnx v1.13.8, quantized pyannote segmentation-3.0, and TitaNet-S embeddings. Speaker detection runs once on saved 16kHz audio before speech inference, in a hidden CPU helper capped at four threads. The helper exits before Whisper or Parakeet loads. Temporary audio and diagnostic files are removed when the operation finishes; cancellation terminates the helper. A known count of one speaker skips the speaker model entirely.

VAD segments are split at speaker boundaries before transcription. Existing speech audio is preserved across those splits, with overlaps labelled Multiple speakers. Speaker labels are saved in SQLite and transcripts.json, displayed in the transcript, and included when copying or generating a summary. Names are editable within one meeting. Retranscription resets them.

On the upstream 56.86-second four-speaker example, the native runtime took approximately 5.5 seconds with two threads. Automatic clustering at the runtime default threshold of 0.5 over-split the example; the selected 0.8 threshold and a known count of four both produced four groups. This is a single sample check, not proof of accuracy across meetings or languages.

201 native tests and 13 frontend tests passed, including timestamp validation, audio preservation across speaker boundaries, PCM conversion, database persistence, meeting-scoped renaming, and settings errors. The UI command audit found no missing native commands. The browser preview timed out; manual desktop and Teams-call validation remains necessary.
The separate Rust-to-native-runtime smoke test also passed: both automatic grouping and a known count of four returned ten turns across four speakers in 8.13 and 8.22 seconds, respectively, with the production four-thread cap. Timings include runtime startup and temporary audio preparation.
The Windows release, installer, and portable ZIP were rebuilt in dist/local-speakers-20261006. Packaged app/model hashes match their build inputs, and the helper in the portable folder independently detected four speakers from the same sample (5.42 seconds with two threads).

## Audio-first workflow and UI responsiveness — 7 October 2026

Stop now saves the WAV and meeting metadata, then opens the meeting immediately. It never calls speech recognition, speaker detection, or summary generation. The saved meeting offers Listen to recording and Transcribe. The media player uses Tauri's file protocol with range requests instead of copying an entire recording through JavaScript. Optional automatic summaries follow the manual Transcribe action.

Manual transcription registers its progress listener before starting, filters updates by meeting ID, and unregisters on success or failure. The global progress bar remains visible across page navigation. Its percentage represents backend stages, not time remaining, and reaches 100 only after the command succeeds.

Windows recording first resolves the default endpoint and its native mix format, avoiding a full endpoint/format scan in the common case. Notification initialization no longer delays the start response. Tray starts use client-side navigation instead of reloading the webview. Startup timing logs separate device configuration from actual stream activation; real microphone start latency still requires hardware measurement.

The UI uses one recording-state poll while capturing, instead of an additional page-level poll. Timer and transcription-progress contexts are isolated from lifecycle state; regression tests verify that their updates do not rerender unrelated recording-state consumers. Concurrent permission checks share one device request, and home-page settings code loads only when opened. The artificial two-second post-save delay has been removed.

Nineteen frontend tests pass, including audio-only saves, manual transcription, double-click protection, stage progress, listener cleanup, lazy playback, device-request sharing, and render isolation.
The native suite passed 201 tests with five opt-in checks skipped. Type checking and the command audit also passed. One parallel Node test run encountered an internal test-runner serialization error after its assertions passed; rerunning the full suite with one test worker passed all nineteen tests.
