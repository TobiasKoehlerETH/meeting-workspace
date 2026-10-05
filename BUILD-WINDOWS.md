# Build Meeting Workspace for Windows

Prerequisites: Node.js, pnpm, Rust, and MSVC C++ Build Tools. The build script uses
the installed Visual Studio 18 BuildTools location and an isolated Python environment
for CMake and libclang.

```powershell
pnpm install --frozen-lockfile
python -m venv .build-tools
.\.build-tools\Scripts\python.exe -m pip install cmake==4.4.4 libclang==18.1.1
.\scripts\build-windows.ps1
```

The source layout uses `app/` for frontend pages, `components/` for UI components,
`src/` for the Rust application, and `src-tauri/` for native configuration and resources.

The installer is generated in `target/windows-app/release/bundle/nsis/`.
The native build also compiles `nemotron-helper`, a separate CPU runtime using
the sherpa-onnx streaming recognizer. Its static runtime avoids conflicts with
the ONNX runtime used by the main app. The installer and portable package include it.
Speech weights download to the local application data directory and are not bundled.
The application executable is `target/windows-app/release/meeting-workspace.exe`.
Use the installer to include the helper executables and runtime resources.

Transcription supports local Parakeet and Whisper models, or OpenRouter with an API key.
Choose **Settings > Transcription > API · OpenRouter**, select a speech model, and save.
Whisper Large V3 Turbo is the default API model. API transcription sends audio to
OpenRouter and requires an internet connection and account credit.
Select **Spoken language > Swiss German → Standard German** for Swiss German input.
Whisper uses the supported German language hint to produce Standard German text.

OpenRouter summaries can reuse the speech API key. The default summary model is
`google/gemini-2.5-flash-lite`. Save a different model or key in Summary settings to override it.

Personal default keys can be stored in `%APPDATA%/local.meetingworkspace.app/transcription-defaults.json`
as `{"apiKey":"YOUR_OPENROUTER_KEY"}`. Saved settings take priority. Keys are not
included in the source, installer, or portable package.

Run the API provider checks with `.\scripts\build-windows.ps1 -TestTranscription`.
After building, run `.\scripts\package-windows-portable.ps1` to create a portable
folder, ZIP, installer copy, and SHA-256 checksums in `dist/`.

This is an unsigned CPU build. It includes FFmpeg, the local summary helper,
templates, the ONNX DirectML runtime, and Microsoft C++/OpenMP redistributable DLLs.
No release signing keys, automatic update endpoints, or telemetry services are used.

The UI follows the A+P workshop style guide. Futura is used when installed locally,
with geometric sans-serif fallbacks. Font files are not bundled.

The app icon source is `public/app-icon.ico`. Derived PNG and platform icons are
stored in `src-tauri/icons/`; the Windows icon and favicon preserve the source ICO.
