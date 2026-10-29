# Build Meeting Workspace for Windows

Install Node.js, pnpm, Rust, MSVC C++ Build Tools, and the [Vulkan SDK](https://vulkan.lunarg.com/sdk/home#windows).
The script uses Visual Studio 18 BuildTools and an isolated Python environment for CMake and libclang.
Windows builds enable Vulkan acceleration for Whisper by default. Set `VULKAN_SDK` to the SDK directory, or place the SDK in `.build-tools/vulkan-sdk`.
The SDK must contain `Bin/glslc.exe`, `Include/vulkan/vulkan.h`, and `Lib/vulkan-1.lib`.
For a local SDK installation, run `.\scripts\setup-vulkan.ps1`. It verifies the pinned LunarG download's checksum and signature, then installs under `.build-tools` without changing the registry or system PATH.

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

The target computer needs a Vulkan driver supplied by its GPU vendor. The SDK is needed only on the build computer.
Use `.\scripts\build-windows.ps1 -SpeechBackend cpu` to build without Vulkan.
The same backend option applies to `-AppOnly` and the native tests. Parakeet, speaker detection, and summaries retain their existing CPU runtimes.
The release script removes inherited Node `--preserve-symlinks` flags before running pnpm. Those flags break dependency resolution with pnpm's package links.

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
.\scripts\build-windows.ps1 -TestWhisperGpu
.\scripts\build-windows.ps1 -TestSummary
.\scripts\build-windows.ps1 -TestSpeakers
```

After building, `.\scripts\package-windows-portable.ps1` creates the portable folder, ZIP, installer copy, and checksums in `dist/`.
Native test commands and `-AppOnly` build and stage the summary helper automatically. The script checks the local CMake and libclang installation before compiling.
The transcription and summary inference checks require the corresponding local model downloads; the summary check uses synthetic meeting text and tests one- and three-line limits.
The transcription check creates its own short speech fixture with Windows speech synthesis; it does not record the microphone.
The GPU check transcribes that fixture with the downloaded `large-v3-turbo-q5_0` model, checks the recognized words, and requires confirmation of Vulkan execution from the native runtime.
Its native output, including the selected GPU, is saved in `.build-tools/whisper-gpu-check.log`.
The Windows build is unsigned. Test live device capture and GPU transcription on each target machine.

The source layout is `app/` for pages, `components/` for UI, `src/` for Rust, and `src-tauri/` for native configuration and resources.
The Windows build stages the pinned sherpa-onnx runtime and two speaker models with checksum verification. They are bundled under `speaker-runtime`; Python is used only by the build script. `-TestSpeakers` checks automatic and known-count grouping against the upstream four-speaker audio fixture.
`scripts/stage-speaker-runtime.ps1` also places these files beside both Cargo executable locations, `target/windows-app/release` and `target/windows-app/release/deps`. It verifies each copied file by SHA-256 and skips unchanged files. Portable packaging uses the same staging check.
The Geist UI font is bundled in `public/fonts/` (SIL OFL). The source app icon is `public/app-icon.ico`.
