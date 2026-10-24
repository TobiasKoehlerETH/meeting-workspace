use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

const STORE_PATH: &str = "startup.json";

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
        && (saved || args.iter().any(|arg| arg == "--minimized"))
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
    fn removed_launch_flag_does_not_hide_the_window() {
        let args = vec!["--stealth".to_string()];
        assert!(!should_start_minimized(&args, false, true));
        assert!(!should_start_minimized(&args, false, false));
    }
}
