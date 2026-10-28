//! Extra timers from joined desks (#196 R2.5). The host's Live State lists each extra timer with its
//! owner (a desk role, or none); a desk may start, pause or reset one when it keeps time (Timekeeper,
//! Present, settings) or when the timer is its role's. Every other desk sees them read only.

use serde::Deserialize;

use crate::command::AuxTimerIn;
use crate::keys::Role;

#[derive(Deserialize)]
struct HostTimers {
    #[serde(default, rename = "auxTimers")]
    aux_timers: Option<Vec<HostTimer>>,
}

#[derive(Deserialize)]
struct HostTimer {
    id: String,
    #[serde(default)]
    owner: Option<String>,
}

/// Whether `role` may do `cmd` to the host's extra timer, from the host's latest Live State: the
/// reason it may not, in plain words.
pub fn judge(live: Option<&str>, role: Role, cmd: &AuxTimerIn) -> Result<(), String> {
    if !matches!(cmd.action.as_str(), "start" | "pause" | "reset") {
        return Err("an extra timer can be started, paused or reset only".into());
    }
    let Some(host) = live.and_then(|j| serde_json::from_str::<HostTimers>(j).ok()) else {
        return Err("the host has not shared its timers yet; try again in a moment".into());
    };
    let Some(timer) = host.aux_timers.unwrap_or_default().into_iter().find(|t| t.id == cmd.id) else {
        return Err("that timer is no longer on the host".into());
    };
    if matches!(role, Role::Timekeeper | Role::Present | Role::Configure) {
        return Ok(());
    }
    match timer.owner.as_deref() {
        Some(owner) if owner == role.as_str() => Ok(()),
        _ => Err("this timer belongs to another desk: the Timekeeper or its own desk runs it".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIVE: &str = r#"{"v":1,"auxTimers":[{"id":"communion","label":"Communion prep","owner":"worship"},{"id":"free","label":"Interpreter"}]}"#;
    fn cmd(id: &str, action: &str) -> AuxTimerIn {
        AuxTimerIn { id: id.into(), action: action.into() }
    }

    #[test]
    fn timekeeping_desks_run_any_timer() {
        for role in [Role::Timekeeper, Role::Present, Role::Configure] {
            assert_eq!(judge(Some(LIVE), role, &cmd("communion", "start")), Ok(()));
            assert_eq!(judge(Some(LIVE), role, &cmd("free", "reset")), Ok(()));
        }
    }

    #[test]
    fn the_owner_role_runs_its_own_timer_only() {
        assert_eq!(judge(Some(LIVE), Role::Worship, &cmd("communion", "pause")), Ok(()));
        assert!(judge(Some(LIVE), Role::Worship, &cmd("free", "start")).is_err());
        assert!(judge(Some(LIVE), Role::Bible, &cmd("communion", "start")).is_err());
    }

    #[test]
    fn unknown_timers_actions_and_older_hosts_are_refused() {
        assert!(judge(Some(LIVE), Role::Timekeeper, &cmd("gone", "start")).is_err());
        assert!(judge(Some(LIVE), Role::Timekeeper, &cmd("free", "delete")).is_err());
        assert!(judge(Some(r#"{"v":1}"#), Role::Timekeeper, &cmd("free", "start")).is_err());
        assert!(judge(None, Role::Timekeeper, &cmd("free", "start")).is_err());
    }
}
