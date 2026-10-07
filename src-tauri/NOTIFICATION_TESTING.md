# Recording notifications and discreet launch

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

## Discreet launch

1. Quit the app, then launch with `--stealth` or enable Discreet launch in Settings
   and restart. The main window should stay hidden. Recording should not start
   automatically.
2. Choose Start Recording from the tray. Check that it uses the saved microphone
   and speaker choices without opening the window. The tooltip should remain
   `Meeting Workspace`, with no app recording notifications.
3. Pause, resume, and stop from the tray. The window should stay hidden throughout.
4. Choose Open Main Window. Recording controls should be accessible. After Stop,
   only audio should be saved. Open the meeting and choose Transcribe to generate
   its local transcript and, when enabled, its local summary. Check the progress
   bar during transcription.
5. Repeat with an unavailable saved device. If starting fails, the tray should
   restore its controls so recording can be retried or Settings opened.
6. While the app is hidden, launch a second instance with `--show`. It should open
   the existing window. Notification suppression remains active until the session
   ends.

The tray menu and an explicitly opened main window still expose recording
controls. Microphone indicators and process listings remain visible to the
operating system.

## Diagnostics

The frontend can inspect `is_stealth_mode_active`, `is_notification_system_ready`,
and `get_notification_settings` through Tauri commands. Saved stealth preferences
apply to the next session; `is_stealth_mode_active` reports the current session.

`get_system_dnd_status` currently returns a fixed value and is not an authoritative
check of operating-system Do Not Disturb. Inspect the operating-system settings
when troubleshooting suppressed notifications.
