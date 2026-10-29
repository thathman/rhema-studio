//! Which app commands each kind of window may call (C3, host permissions). The main desk window may
//! call any; an output window only what it draws and sends frames with; any other window nothing.
//! Before this every command was open to every window, so an output window (which shows web
//! content, camera streams and media) could have replaced the remote-access keys.

use tauri::ipc::Invoke;
use tauri::Runtime;

/// What an output window (`broadcast-<id>`) uses: see `src/broadcast-output.tsx`.
const OUTPUT_WINDOW_COMMANDS: &[&str] = &["get_ndi_status", "push_ndi_frame", "push_ndi_region", "set_output_pace", "whep_offer", "recorder_status"];

/// May the window labelled `label` call `command`? Default deny for unknown window kinds.
pub fn may_call(label: &str, command: &str) -> bool {
    match label {
        "main" => true,
        _ if label.starts_with("broadcast-") => OUTPUT_WINDOW_COMMANDS.contains(&command),
        _ => false,
    }
}

/// Wrap the generated command handler so every call is checked against [`may_call`] first.
pub fn guard<R: Runtime>(handler: impl Fn(Invoke<R>) -> bool + Send + Sync + 'static) -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static {
    move |invoke: Invoke<R>| {
        let label = invoke.message.webview_ref().label().to_owned();
        let command = invoke.message.command().to_owned();
        if may_call(&label, &command) {
            return handler(invoke);
        }
        log::warn!("refused command '{command}' from window '{label}'");
        invoke.resolver.reject(format!("'{command}' is not available in this window"));
        true
    }
}

#[cfg(test)]
mod tests {
    use super::may_call;

    #[test]
    fn the_main_desk_may_call_anything() {
        assert!(may_call("main", "remote_set_keys"));
        assert!(may_call("main", "push_ndi_frame"));
    }

    #[test]
    fn an_output_window_may_only_draw_and_send_frames() {
        for ok in ["push_ndi_frame", "push_ndi_region", "set_output_pace", "get_ndi_status", "whep_offer", "recorder_status"] {
            assert!(may_call("broadcast-main", ok), "{ok}");
        }
        for refused in ["remote_set_keys", "remote_pair_start", "start_http", "stop_http", "start_osc", "feeds_set", "publish_live_state", "recorder_start", "recorder_stop", "content_delete_service_log", "media_delete"] {
            assert!(!may_call("broadcast-main", refused), "{refused}");
        }
    }

    #[test]
    fn unknown_windows_get_nothing() {
        assert!(!may_call("", "get_ndi_status"));
        assert!(!may_call("mainx", "remote_set_keys"));
        assert!(!may_call("feed", "push_ndi_frame"));
    }
}
