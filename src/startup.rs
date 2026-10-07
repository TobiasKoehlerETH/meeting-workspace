use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_store::StoreExt;

const STORE_PATH: &str = "startup.json";

/// Fixed for this session; changing launch preferences takes effect next time.
pub struct LaunchMode {
    pub stealth: bool,
}

pub fn is_stealth<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.try_state::<LaunchMode>().is_some_and(|mode| mode.stealth)
}

#[tauri::command]
pub fn is_stealth_mode_active<R: Runtime>(app: AppHandle<R>) -> bool {
    is_stealth(&app)
}

#[tauri::command]
pub fn get_stealth_mode<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    let store = app.store(STORE_PATH).map_err(|error| error.to_string())?;
    Ok(store.get("stealth_mode").and_then(|value| value.as_bool()).unwrap_or(false))
}

#[tauri::command]
pub fn set_stealth_mode<R: Runtime>(app: AppHandle<R>, enabled: bool) -> Result<(), String> {
    let store = app.store(STORE_PATH).map_err(|error| error.to_string())?;
    store.set("stealth_mode", enabled);
    store.save().map_err(|error| format!("Could not save the discreet launch preference: {error}"))
}

pub fn stealth_requested(args: &[String], saved: bool) -> bool {
    !args.iter().any(|arg| arg == "--show")
        && (saved || args.iter().any(|arg| arg == "--stealth"))
}

#[tauri::command]
pub fn get_start_minimized<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    let store = app.store(STORE_PATH).map_err(|error| error.to_string())?;
    Ok(store.get("start_minimized").and_then(|value| value.as_bool()).unwrap_or(false))
}

#[tauri::command]
pub fn set_start_minimized<R: Runtime>(app: AppHandle<R>, enabled: bool) -> Result<(), String> {
    let store = app.store(STORE_PATH).map_err(|error| error.to_string())?;
    store.set("start_minimized", enabled);
    store.save().map_err(|error| format!("Could not save the launch preference: {error}"))
}

pub fn should_start_minimized(args: &[String], saved: bool, tray_available: bool) -> bool {
    // Always leave a way to reach the app, even when the tray cannot be created.
    tray_available && !args.iter().any(|arg| arg == "--show")
        && (saved || args.iter().any(|arg| arg == "--minimized" || arg == "--stealth"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_preference_can_be_overridden_and_requires_a_tray() {
        let args = |values: &[&str]| values.iter().map(|value| value.to_string()).collect::<Vec<_>>();
        assert!(!should_start_minimized(&[], false, true));
        assert!(should_start_minimized(&[], true, true));
        assert!(should_start_minimized(&args(&["--minimized"]), false, true));
        assert!(!should_start_minimized(&args(&["--minimized", "--show"]), true, true));
        assert!(!should_start_minimized(&args(&["--minimized"]), true, false));
    }

    #[test]
    fn discreet_launch_can_be_requested_or_overridden() {
        let args = |values: &[&str]| values.iter().map(|value| value.to_string()).collect::<Vec<_>>();
        assert!(!stealth_requested(&[], false));
        assert!(stealth_requested(&[], true));
        assert!(stealth_requested(&args(&["--stealth"]), false));
        assert!(!stealth_requested(&args(&["--stealth", "--show"]), true));
        assert!(!stealth_requested(&args(&["--minimized"]), false));
        assert!(should_start_minimized(&args(&["--stealth"]), false, true));
        assert!(!should_start_minimized(&args(&["--stealth"]), false, false));
    }
}
