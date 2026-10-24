use tauri::{
    Emitter,
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, PhysicalPosition, PhysicalRect, PhysicalSize, Runtime, WebviewWindow,
};

#[derive(Debug, Clone)]
pub enum RecordingState {
    Stopped,
    Starting,
    Recording,
    Pausing,
    Paused,
    Resuming,
    Stopping,
}

fn recording_status_label(state: &RecordingState) -> &'static str {
    match state {
        RecordingState::Stopped => "Meeting Workspace — Not recording",
        RecordingState::Starting => "Meeting Workspace — Starting recording",
        RecordingState::Recording => "Meeting Workspace — Recording",
        RecordingState::Pausing => "Meeting Workspace — Pausing recording",
        RecordingState::Paused => "Meeting Workspace — Recording paused",
        RecordingState::Resuming => "Meeting Workspace — Resuming recording",
        RecordingState::Stopping => "Meeting Workspace — Saving recording",
    }
}

pub fn create_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    // Start with default menu, will update with actual state after initialization
    // Pass can_record=true initially, will be updated by update_tray_menu immediately
    let menu = build_menu(app, RecordingState::Stopped, true)?;

    TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .tooltip(recording_status_label(&RecordingState::Stopped))
        .icon(app.default_window_icon().unwrap().clone())
        .on_menu_event(|app, event| handle_menu_event(app, event.id.as_ref()))
        .build(app)?;

    // Update tray menu with actual recording state after creation
    update_tray_menu(app);

    Ok(())
}

fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, item_id: &str) {
    match item_id {
        "toggle_recording" => toggle_recording_handler(app),
        "pause_recording" => pause_recording_handler(app),
        "resume_recording" => resume_recording_handler(app),
        "stop_recording" => stop_recording_handler(app),
        "open_window" => focus_main_window(app),
        "settings" => {
            focus_main_window(app);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval("window.openSettings?.()");
            }
        }
        "quit" => app.exit(0),
        _ => {}
    }
}
fn toggle_recording_handler<R: Runtime>(app: &AppHandle<R>) {
    focus_main_window(app);
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        if crate::is_recording().await {
            stop_recording_handler(&app_clone);
        } else {
            // The frontend may reject a start while saving or transcribing.
            // Keep the actual tray state until capture confirms it has started.
            log::info!("Emitting start recording event from tray");
            if let Err(error) = app_clone.emit("request-recording-toggle", ()) {
                log::error!("Could not start recording from the tray: {}", error);
                update_tray_menu_async(&app_clone).await;
            }
        }
    });
}

fn pause_recording_handler<R: Runtime>(app: &AppHandle<R>) {
    // Immediately show pausing state
    set_tray_state(app, RecordingState::Pausing);

    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = crate::audio::recording_commands::pause_recording(app_clone.clone()).await {
            log::error!("Failed to pause recording from tray: {}", e);
            // Revert to current state on error
            update_tray_menu_async(&app_clone).await;
        } else {
            log::info!("Recording paused from tray");
            // The pause_recording function will call update_tray_menu, so no need to call it here
        }
    });
}

fn resume_recording_handler<R: Runtime>(app: &AppHandle<R>) {
    // Immediately show resuming state
    set_tray_state(app, RecordingState::Resuming);

    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = crate::audio::recording_commands::resume_recording(app_clone.clone()).await
        {
            log::error!("Failed to resume recording from tray: {}", e);
            // Revert to current state on error
            update_tray_menu_async(&app_clone).await;
        } else {
            log::info!("Recording resumed from tray");
            // The resume_recording function will call update_tray_menu, so no need to call it here
        }
    });
}

fn stop_recording_handler<R: Runtime>(app: &AppHandle<R>) {
    // Immediately show stopping state
    set_tray_state(app, RecordingState::Stopping);

    focus_main_window(app);
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        log::info!("Tray: Stopping recording...");

        // Generate save path (same as RecordingControls.tsx)
        let data_dir = match app_clone.path().app_data_dir() {
            Ok(dir) => dir,
            Err(e) => {
                log::error!("Failed to get app data dir: {}", e);
                update_tray_menu_async(&app_clone).await;
                return;
            }
        };

        let timestamp = chrono::Local::now().format("%Y-%m-%dT%H-%M-%S").to_string();
        let save_path = data_dir.join(format!("recording-{}.wav", timestamp));

        // Call Rust stop_recording command (like pause/resume pattern)
        let stop_result = crate::audio::recording_commands::stop_recording(
            app_clone.clone(),
            crate::audio::recording_commands::RecordingArgs {
                save_path: save_path.to_string_lossy().to_string(),
            },
        )
        .await;

        // Handle result
        match stop_result {
            Ok(_) => {
                log::info!("Tray: Recording stopped successfully");

                // Trigger frontend post-processing via event (works from any page)
                // (SQLite save, navigation, analytics)
                if let Err(e) = app_clone.emit("recording-stop-complete", true) {
                    log::error!("Tray: Failed to emit recording-stop-complete event: {}", e);
                }
            }
            Err(e) => {
                log::error!("Tray: Failed to stop recording: {}", e);
                // Revert tray state on error
                update_tray_menu_async(&app_clone).await;
            }
        }
    });
}

pub fn update_tray_menu<R: Runtime>(app: &AppHandle<R>) {
    // For sync update, spawn async task to get current state
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        // Small delay to ensure recording state has been updated
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        update_tray_menu_async(&app_clone).await;
    });
}

pub fn set_tray_state<R: Runtime>(app: &AppHandle<R>, state: RecordingState) {
    log::info!("Tray: Setting intermediate state: {:?}", state);
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_tooltip(Some(recording_status_label(&state)));
    }
    // During recording state transitions, we assume recording is allowed (we're already recording)
    if let Ok(menu) = build_menu(app, state, true) {
        if let Some(tray) = app.tray_by_id("main-tray") {
            let result = tray.set_menu(Some(menu));
            log::info!("Tray: Intermediate state menu update result: {:?}", result);
        } else {
            log::warn!("Tray: Could not find tray with id 'main-tray'");
        }
    } else {
        log::error!("Tray: Failed to build menu for intermediate state");
    }
}

async fn get_current_recording_state() -> RecordingState {
    // Check if currently recording
    let is_recording = crate::audio::recording_commands::is_recording().await;
    log::info!(
        "Tray: get_current_recording_state - is_recording: {}",
        is_recording
    );

    if !is_recording {
        log::info!("Tray: Recording state is Stopped");
        return RecordingState::Stopped;
    }

    // Check if paused
    let is_paused = crate::audio::recording_commands::is_recording_paused().await;
    log::info!("Tray: is_paused: {}", is_paused);

    if is_paused {
        log::info!("Tray: Recording state is Paused");
        RecordingState::Paused
    } else {
        log::info!("Tray: Recording state is Recording");
        RecordingState::Recording
    }
}

/// Check if recording is allowed based on onboarding status and transcription model availability
/// Returns true if:
/// - Onboarding is complete (user may prefer Whisper later), OR
/// - Parakeet transcription model is ready (downloaded)
async fn check_can_record<R: Runtime>(app: &AppHandle<R>) -> bool {
    // First check if onboarding is complete
    let onboarding_complete = match crate::onboarding::load_onboarding_status(app).await {
        Ok(status) => status.completed,
        Err(e) => {
            log::warn!("Tray: Failed to load onboarding status: {}, assuming complete", e);
            true // Assume complete if we can't check (safe default)
        }
    };

    // If onboarding is complete, always allow recording
    // (user may prefer Whisper or have their own transcription setup)
    if onboarding_complete {
        return true;
    }

    // During onboarding, check if Parakeet transcription model is ready
    match crate::parakeet_engine::commands::parakeet_has_available_models().await {
        Ok(has_models) => has_models,
        Err(e) => {
            log::warn!("Tray: Failed to check Parakeet models: {}, assuming not ready", e);
            false
        }
    }
}

pub async fn update_tray_menu_async<R: Runtime>(app: &AppHandle<R>) {
    log::info!("Tray: update_tray_menu_async called");
    // Get the current recording state
    let recording_state = get_current_recording_state().await;
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_tooltip(Some(recording_status_label(&recording_state)));
    }
    log::info!("Tray: Current recording state: {:?}", recording_state);

    // Determine if recording should be allowed
    // Only block recording during incomplete onboarding when no transcription model is ready
    let can_record = check_can_record(app).await;
    log::info!("Tray: can_record: {}", can_record);

    if let Ok(menu) = build_menu(app, recording_state, can_record) {
        if let Some(tray) = app.tray_by_id("main-tray") {
            let result = tray.set_menu(Some(menu));
            log::info!("Tray: Menu update result: {:?}", result);
        } else {
            log::warn!("Tray: Could not find tray with id 'main-tray'");
        }
    } else {
        log::error!("Tray: Failed to build menu");
    }
}

fn build_menu<R: Runtime>(
    app: &AppHandle<R>,
    state: RecordingState,
    can_record: bool, // True if recording is allowed (onboarding complete OR transcription model ready)
) -> tauri::Result<tauri::menu::Menu<R>> {
    let mut builder = MenuBuilder::new(app);

    // If recording is not allowed (during onboarding, no transcription model), show disabled message
    if !can_record {
        builder = builder.item(
            &MenuItemBuilder::new("Recording unavailable")
                .enabled(false)
                .build(app)?,
        );
    } else {
        match state {
            RecordingState::Stopped => {
                builder = builder
                    .item(&MenuItemBuilder::with_id("toggle_recording", "Start Recording").build(app)?);
            }
            RecordingState::Starting => {
                builder = builder.item(
                    &MenuItemBuilder::new("Starting...")
                        .enabled(false)
                        .build(app)?,
                );
            }
            RecordingState::Recording => {
                builder = builder
                    .item(&MenuItemBuilder::with_id("pause_recording", "Pause").build(app)?)
                    .item(&MenuItemBuilder::with_id("stop_recording", "Stop").build(app)?);
            }
            RecordingState::Pausing => {
                builder = builder
                    .item(
                        &MenuItemBuilder::new("Pausing...")
                            .enabled(false)
                            .build(app)?,
                    )
                    .item(&MenuItemBuilder::with_id("stop_recording", "Stop").build(app)?);
            }
            RecordingState::Paused => {
                builder = builder
                    .item(
                        &MenuItemBuilder::with_id("resume_recording", "Resume")
                            .build(app)?,
                    )
                    .item(&MenuItemBuilder::with_id("stop_recording", "Stop").build(app)?);
            }
            RecordingState::Resuming => {
                builder = builder
                    .item(
                        &MenuItemBuilder::new("Resuming...")
                            .enabled(false)
                            .build(app)?,
                    )
                    .item(&MenuItemBuilder::with_id("stop_recording", "Stop").build(app)?);
            }
            RecordingState::Stopping => {
                builder = builder.item(
                    &MenuItemBuilder::new("Stopping...")
                        .enabled(false)
                        .build(app)?,
                );
            }
        }
    }

    builder
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&MenuItemBuilder::with_id("open_window", "Open Main Window").build(app)?)
        .item(&MenuItemBuilder::with_id("settings", "Settings").build(app)?)
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&MenuItemBuilder::with_id("quit", "Quit").build(app)?)
        .build()
}

pub(crate) fn focus_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(e) = window.unminimize() {
            log::error!("Failed to unminimize main window: {}", e);
        }

        if let Err(e) = keep_main_window_in_view(&window) {
            log::error!("Failed to restore main window to a visible monitor: {}", e);
        }

        if let Err(e) = window.show() {
            log::error!("Failed to show main window: {}", e);
        }

        if let Err(e) = window.set_focus() {
            log::error!("Failed to focus main window: {}", e);
        }

        if let Err(e) = window.eval("window.focus()") {
            log::error!("Failed to focus main webview: {}", e);
        }
    } else {
        log::warn!("Could not find main window");
    }
}

fn keep_main_window_in_view<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    if window.is_maximized()? || window.is_fullscreen()? {
        return Ok(());
    }

    let position = window.outer_position()?;
    let size = window.outer_size()?;
    let monitors = window.available_monitors()?;
    if monitors.iter().any(|monitor| {
        let area = monitor.work_area();
        size.width <= area.size.width
            && size.height <= area.size.height
            && position == clamp_window_position(position, size, area)
    }) {
        return Ok(());
    }

    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
        .or_else(|| monitors.into_iter().next());
    if let Some(monitor) = monitor {
        let area = monitor.work_area();
        window.set_position(clamp_window_position(position, size, area))?;

        // Moving between monitors can change the physical size when their DPI differs.
        let outer_size = window.outer_size()?;
        let inner_size = window.inner_size()?;
        let fitted_size = fitted_inner_size(inner_size, outer_size, area.size);
        if fitted_size != inner_size {
            window.set_size(fitted_size)?;
        }
        window.set_position(clamp_window_position(
            window.outer_position()?,
            window.outer_size()?,
            area,
        ))?;
    }
    Ok(())
}

fn fitted_inner_size(
    inner: PhysicalSize<u32>,
    outer: PhysicalSize<u32>,
    available: PhysicalSize<u32>,
) -> PhysicalSize<u32> {
    PhysicalSize::new(
        inner.width.saturating_sub(outer.width.saturating_sub(available.width)).max(1),
        inner.height.saturating_sub(outer.height.saturating_sub(available.height)).max(1),
    )
}

fn clamp_window_position(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    area: &PhysicalRect<i32, u32>,
) -> PhysicalPosition<i32> {
    // Oversized windows keep their title bar reachable at the work area's origin.
    let max_x = i64::from(area.position.x) + i64::from(area.size.width.saturating_sub(size.width));
    let max_y = i64::from(area.position.y) + i64::from(area.size.height.saturating_sub(size.height));
    PhysicalPosition::new(
        i64::from(position.x).clamp(i64::from(area.position.x), max_x) as i32,
        i64::from(position.y).clamp(i64::from(area.position.y), max_y) as i32,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tooltip_always_includes_the_recording_status() {
        for state in [RecordingState::Stopped, RecordingState::Starting,
            RecordingState::Recording, RecordingState::Pausing, RecordingState::Paused,
            RecordingState::Resuming, RecordingState::Stopping] {
            assert!(recording_status_label(&state).starts_with("Meeting Workspace — "));
            assert!(recording_status_label(&state).to_lowercase().contains("recording"));
        }
    }

    #[test]
    fn window_position_respects_negative_monitor_coordinates_and_taskbar() {
        let area = PhysicalRect {
            position: PhysicalPosition::new(-1920, 0),
            size: PhysicalSize::new(1920, 1040),
        };
        let size = PhysicalSize::new(1000, 700);
        assert_eq!(
            clamp_window_position(PhysicalPosition::new(3000, 1500), size, &area),
            PhysicalPosition::new(-1000, 340),
        );
        assert_eq!(
            clamp_window_position(PhysicalPosition::new(-2500, -200), size, &area),
            PhysicalPosition::new(-1920, 0),
        );
    }

    #[test]
    fn visible_window_keeps_its_position() {
        let area = PhysicalRect {
            position: PhysicalPosition::new(0, 40),
            size: PhysicalSize::new(1920, 1040),
        };
        let position = PhysicalPosition::new(100, 100);
        assert_eq!(
            clamp_window_position(position, PhysicalSize::new(1000, 700), &area),
            position,
        );
    }

    #[test]
    fn oversized_window_keeps_its_title_bar_in_view() {
        let area = PhysicalRect {
            position: PhysicalPosition::new(0, 40),
            size: PhysicalSize::new(800, 560),
        };
        assert_eq!(
            clamp_window_position(
                PhysicalPosition::new(-100, 1200),
                PhysicalSize::new(1000, 700),
                &area,
            ),
            area.position,
        );
    }

    #[test]
    fn oversized_window_fits_with_its_frame_inside_the_work_area() {
        assert_eq!(
            fitted_inner_size(
                PhysicalSize::new(1000, 700),
                PhysicalSize::new(1016, 739),
                PhysicalSize::new(800, 600),
            ),
            PhysicalSize::new(784, 561),
        );
        assert_eq!(
            fitted_inner_size(
                PhysicalSize::new(1000, 700),
                PhysicalSize::new(1016, 739),
                PhysicalSize::new(1920, 1080),
            ),
            PhysicalSize::new(1000, 700),
        );
    }
}
