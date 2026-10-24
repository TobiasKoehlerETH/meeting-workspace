# Build Meeting Workspace for Windows

Install Node.js, pnpm, Rust, and MSVC C++ Build Tools. The script uses Visual Studio 18 BuildTools and an isolated Python environment for CMake and libclang.

```powershell
pnpm install --frozen-lockfile
python -m venv .build-tools
.\.build-tools\Scripts\python.exe -m pip install cmake==4.4.4 libclang==18.1.1
.\scripts\build-windows.ps1
```

The installer is generated in `target/windows-app/release/bundle/nsis/`.
The application executable is `target/windows-app/release/meeting-workspace.exe`.
The package includes the local `llama-helper` summary runtime, FFmpeg, templates, ONNX runtime, and required Microsoft DLLs.
The retired live speech helper is no longer built or bundled.

Speech and summary weights download through Settings and are stored in the local application data directory.
Quantized Whisper Turbo is the default speech model for new setups. Local summaries default to Qwen 3.5 4B; onboarding can recommend a smaller model on low-memory systems.

```powershell
pnpm check
pnpm test
pnpm build
python -m unittest discover -s tests -p 'test_*.py'
.\scripts\build-windows.ps1 -TestUnit
.\scripts\build-windows.ps1 -TestHelper
.\scripts\build-windows.ps1 -TestTranscription
.\scripts\build-windows.ps1 -TestSummary
.\scripts\build-windows.ps1 -TestSpeakers
```

After building, `.\scripts\package-windows-portable.ps1` creates the portable folder, ZIP, installer copy, and checksums in `dist/`.
Native test commands and `-AppOnly` build and stage the summary helper automatically. The script checks the local CMake and libclang installation before compiling.
The transcription and summary inference checks require the corresponding local model downloads; the summary check uses synthetic meeting text and tests one- and three-line limits.
The transcription check creates its own short speech fixture with Windows speech synthesis; it does not record the microphone.
The Windows build is unsigned. Live device capture and hardware acceleration need testing on the target machine.

The source layout is `app/` for pages, `components/` for UI, `src/` for Rust, and `src-tauri/` for native configuration and resources.
The Windows build stages the pinned sherpa-onnx runtime and two speaker models with checksum verification. They are bundled under `speaker-runtime`; Python is used only by the build script. `-TestSpeakers` checks automatic and known-count grouping against the upstream four-speaker audio fixture.
The Geist UI font is bundled in `public/fonts/` (SIL OFL). The source app icon is `public/app-icon.ico`.
