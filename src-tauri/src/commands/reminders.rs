//! The host side of automatic Timekeeper reminders (`rhema_api::reminders`, doc 35 C): the main
//! desk's policy and the reminders already sent, kept in the app data folder so a restart repeats
//! none, and each Live State the app publishes checked for one due. A due reminder goes to the main
//! window as `timing:reminder`, which sends it as a Comms notice to its destinations.

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock, PoisonError};

use rhema_api::reminders::{due, ReminderPolicy};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

/// What is kept: the policy and the keys of reminders sent.
#[derive(Default, Serialize, Deserialize)]
struct Saved {
    #[serde(default)]
    policy: ReminderPolicy,
    #[serde(default)]
    fired: BTreeSet<String>,
}

/// More sent keys than any service run makes: past this, the oldest services' are forgotten.
const FIRED_MAX: usize = 2_000;

#[derive(Default)]
pub struct Reminders(OnceLock<Mutex<(Saved, Option<PathBuf>)>>);

impl Reminders {
    fn state(&self, app: &AppHandle) -> &Mutex<(Saved, Option<PathBuf>)> {
        self.0.get_or_init(|| {
            let path = app.path().app_data_dir().ok().map(|d| d.join("reminders.json"));
            let saved = path.as_ref().and_then(|p| std::fs::read(p).ok()).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
            Mutex::new((saved, path))
        })
    }
}

fn save(saved: &Saved, path: Option<&PathBuf>) {
    let Some(path) = path else { return };
    if let Ok(text) = serde_json::to_vec(saved) {
        let tmp = path.with_extension("json.new");
        if std::fs::write(&tmp, text).is_ok() {
            let _ = std::fs::rename(&tmp, path);
        }
    }
}

/// The main desk's reminder policy (none: no automatic reminders).
#[tauri::command]
pub fn reminders_policy(app: AppHandle, reminders: State<'_, Reminders>) -> ReminderPolicy {
    reminders.state(&app).lock().unwrap_or_else(PoisonError::into_inner).0.policy.clone()
}

/// Set the reminder policy; answers it as kept (thresholds in range, largest first).
#[tauri::command]
pub fn reminders_set_policy(app: AppHandle, reminders: State<'_, Reminders>, policy: ReminderPolicy) -> ReminderPolicy {
    let mut s = reminders.state(&app).lock().unwrap_or_else(PoisonError::into_inner);
    s.0.policy = policy.checked();
    save(&s.0, s.1.as_ref());
    s.0.policy.clone()
}

/// Each Live State the app publishes: send any reminder now due.
pub fn observe(app: &AppHandle, live_json: &str) {
    let Some(reminders) = app.try_state::<Reminders>() else { return };
    let sent = {
        let mut s = reminders.state(app).lock().unwrap_or_else(PoisonError::into_inner);
        if s.0.policy.thresholds_min.is_empty() {
            return;
        }
        let (saved, path) = &mut *s;
        let sent = due(&saved.policy, live_json, &mut saved.fired);
        if !sent.is_empty() {
            if saved.fired.len() > FIRED_MAX {
                saved.fired.clear();
            }
            save(saved, path.as_ref());
        }
        sent
    };
    for r in sent {
        log::info!("reminder: {} to {:?}", r.text, r.to);
        let _ = app.emit_to("main", "timing:reminder", &r);
    }
}
