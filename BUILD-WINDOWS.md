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
The application executable is `target/windows-app/release/meeting-workspace.exe`.
Use the installer to include the helper executables and runtime resources.

This is an unsigned CPU build. It includes FFmpeg, the local summary helper,
templates, the ONNX DirectML runtime, and Microsoft C++/OpenMP redistributable DLLs.
No release signing keys, automatic update endpoints, or telemetry services are used.

The UI follows the A+P workshop style guide. Futura is used when installed locally,
with geometric sans-serif fallbacks. Font files are not bundled.
