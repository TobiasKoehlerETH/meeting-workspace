# Recording notifications and tray launch

These are manual checks for a packaged desktop build. Complete model setup first.
Native operating-system permissions and microphone indicators are separate from
the app's notification preferences.

## Normal launch

1. Quit the app, then launch with `--show` to override saved launch preferences.
2. Enable recording notifications in Settings > General.
3. Start, pause, resume, and stop a short recording. Check the corresponding
   enabled notifications and the tray's recording status.
4. Disable recording notifications and repeat. Disabled notifications should
   remain silent. The operating system may independently suppress notifications.

## Start minimized

1. Quit the app, then launch with `--minimized` or enable Start minimized in Settings
   and restart. The main window should stay hidden. Recording should not start
   automatically.
2. Choose Start Recording from the tray. Check that it uses the saved microphone
   and speaker choices and opens the window. The tooltip should show recording
   status, and enabled app recording notifications should appear.
3. Pause, resume, and stop from the tray. Check that the window's controls and
   tray status stay in sync.
4. Choose Open Main Window. Recording controls should be accessible. After Stop,
   only audio should be saved. Open the meeting and choose Transcribe to generate
   its local transcript and, when enabled, its local summary. Check the progress
   bar during transcription.
5. Repeat with an unavailable saved device. If starting fails, the tray should
   restore its controls so recording can be retried or Settings opened.
6. While the app is hidden, launch a second instance with `--show`. It should open
   the existing window.

## Diagnostics

The frontend can inspect `is_notification_system_ready` and
`get_notification_settings` through Tauri commands.

`get_system_dnd_status` currently returns a fixed value and is not an authoritative
check of operating-system Do Not Disturb. Inspect the operating-system settings
when troubleshooting suppressed notifications.
