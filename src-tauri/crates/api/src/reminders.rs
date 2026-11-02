//! Automatic Timekeeper reminders (doc 35 C, owner-approved dual model): the main host configures
//! which "minutes left" thresholds remind, to whom and how urgently; the host sends each one once per
//! event as the service runs, from its own Live State, so a desk that disconnected does not stop or
//! repeat them. Manual reminders stay Comms notices sent by a Timekeeper.
//!
//! Rules from doc 35: each threshold fires once per event (deduplicated across re-offset, reconnect
//! and restart, the caller keeping `fired`); nothing fires while the service is on Hold; and only a
//! threshold crossed within the last `GRACE_MS` fires, so a Resume or a restart never sends a burst
//! of overdue reminders.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

/// A threshold crossed longer ago than this is past: it is not sent late.
pub const GRACE_MS: i64 = 30_000;

/// The host's reminder policy. No thresholds: no automatic reminders (the default).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderPolicy {
    /// Minutes left in the current event at which to remind (e.g. 10, 5, 2). At most 6, 1–180.
    #[serde(default)]
    pub thresholds_min: Vec<u32>,
    /// Who hears it, as Comms notice destinations (`"role:stage"`, a desk's name, …). At most 8.
    #[serde(default)]
    pub to: Vec<String>,
    /// A prominent message rather than a subtle banner (doc 35 C1; routine by default).
    #[serde(default)]
    pub urgent: bool,
}

impl ReminderPolicy {
    /// The policy as the host keeps it: thresholds in range, deduplicated, largest first; at most
    /// eight short destinations.
    #[must_use]
    pub fn checked(mut self) -> Self {
        self.thresholds_min.retain(|m| (1..=180).contains(m));
        self.thresholds_min.sort_unstable_by(|a, b| b.cmp(a));
        self.thresholds_min.dedup();
        self.thresholds_min.truncate(6);
        self.to = self.to.into_iter().map(|t| t.trim().chars().take(84).collect::<String>()).filter(|t| !t.is_empty()).take(8).collect();
        self
    }
}

/// One reminder due now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    pub service_id: String,
    pub event_id: String,
    /// The event's name, as the run of show says it.
    pub reference: String,
    pub minutes_left: u32,
    pub to: Vec<String>,
    pub urgent: bool,
    /// The words of the notice: "Sermon: 5 minutes left".
    pub text: String,
}

/// What a Live State says about the current event's time, if it says enough.
struct Now {
    service: String,
    event: String,
    reference: String,
    remaining_ms: i64,
}

fn now_of(live: &serde_json::Value) -> Option<Now> {
    if !live.get("hold").is_none_or(serde_json::Value::is_null) {
        return None;
    }
    let event = live.pointer("/event/currentId")?.as_str()?.to_string();
    let elapsed = live.pointer("/event/currentElapsedMs")?.as_i64()?;
    let target = live.pointer("/event/targets")?.as_array()?.iter().find(|t| t.get("id").and_then(serde_json::Value::as_str) == Some(event.as_str()))?;
    let planned_min = target.get("plannedMinutes")?.as_i64()?;
    if planned_min <= 0 {
        return None;
    }
    Some(Now {
        service: live.pointer("/service/id").and_then(serde_json::Value::as_str).unwrap_or("").to_string(),
        reference: target.get("reference").and_then(serde_json::Value::as_str).unwrap_or("This event").chars().take(80).collect(),
        event,
        remaining_ms: planned_min * 60_000 - elapsed,
    })
}

/// The key a sent reminder is remembered by.
fn key(service: &str, event: &str, minutes: u32) -> String {
    format!("{service}\u{1f}{event}\u{1f}{minutes}")
}

/// The reminders due in this Live State under `policy`, recording each in `fired` so it is never
/// sent again for that event.
pub fn due(policy: &ReminderPolicy, live_json: &str, fired: &mut BTreeSet<String>) -> Vec<Reminder> {
    if policy.thresholds_min.is_empty() || policy.to.is_empty() {
        return Vec::new();
    }
    let Some(now) = serde_json::from_str::<serde_json::Value>(live_json).ok().as_ref().and_then(now_of) else { return Vec::new() };
    let mut out = Vec::new();
    for &minutes in &policy.thresholds_min {
        let at = i64::from(minutes) * 60_000;
        if now.remaining_ms <= at && now.remaining_ms > at - GRACE_MS && fired.insert(key(&now.service, &now.event, minutes)) {
            out.push(Reminder {
                service_id: now.service.clone(),
                event_id: now.event.clone(),
                reference: now.reference.clone(),
                minutes_left: minutes,
                to: policy.to.clone(),
                urgent: policy.urgent,
                text: format!("{}: {minutes} minute{} left", now.reference, if minutes == 1 { "" } else { "s" }),
            });
        }
    }
    // Only the most pressing of several crossed at once (a big re-offset): one cue, not a burst.
    out.sort_by_key(|r| r.minutes_left);
    out.truncate(1);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn live(event: &str, planned_min: i64, elapsed_ms: i64, hold: bool) -> String {
        serde_json::json!({
            "v": 1, "service": { "id": "s1" },
            "event": { "currentId": event, "currentElapsedMs": elapsed_ms, "targets": [{ "id": "sermon", "reference": "Sermon", "plannedMinutes": planned_min, "kind": "event" }, { "id": "worship", "reference": "Worship", "plannedMinutes": 20, "kind": "event" }] },
            "hold": if hold { serde_json::json!({ "reason": "", "since": 1 }) } else { serde_json::Value::Null },
        })
        .to_string()
    }

    fn policy() -> ReminderPolicy {
        ReminderPolicy { thresholds_min: vec![2, 10, 5], to: vec!["role:stage".into()], urgent: false }.checked()
    }

    #[test]
    fn each_threshold_reminds_once_as_the_event_runs() {
        let p = policy();
        let mut fired = BTreeSet::new();
        let at = |left_s: i64| live("sermon", 30, 30 * 60_000 - left_s * 1000, false);
        assert!(due(&p, &at(11 * 60), &mut fired).is_empty(), "11 minutes left");
        let ten = due(&p, &at(599), &mut fired);
        assert_eq!(ten.iter().map(|r| (r.minutes_left, r.text.as_str())).collect::<Vec<_>>(), vec![(10, "Sermon: 10 minutes left")]);
        assert!(due(&p, &at(590), &mut fired).is_empty(), "not again a few seconds later");
        assert_eq!(due(&p, &at(298), &mut fired)[0].minutes_left, 5);
        assert_eq!(due(&p, &at(119), &mut fired)[0].to, vec!["role:stage".to_string()]);
        assert!(due(&p, &at(60), &mut fired).is_empty());
    }

    #[test]
    fn never_on_hold_and_never_late_after_a_resume_or_restart() {
        let p = policy();
        let mut fired = BTreeSet::new();
        assert!(due(&p, &live("sermon", 30, 30 * 60_000 - 299_000, true), &mut fired).is_empty(), "on Hold");
        // Resumed (or the host restarted) two minutes after the 5-minute mark: not sent late.
        assert!(due(&p, &live("sermon", 30, 30 * 60_000 - 180_000, false), &mut fired).is_empty());
        // A re-offset that crosses several thresholds at once sends only the most pressing.
        let mut fresh = BTreeSet::new();
        let r = due(&ReminderPolicy { thresholds_min: vec![5, 4], to: vec!["role:stage".into()], urgent: true }, &live("sermon", 30, 30 * 60_000 - 235_000, false), &mut fresh);
        assert_eq!(r.iter().map(|r| (r.minutes_left, r.urgent)).collect::<Vec<_>>(), vec![(4, true)]);
    }

    #[test]
    fn a_reconnect_or_restart_with_the_same_record_repeats_nothing() {
        let p = policy();
        let mut fired = BTreeSet::new();
        assert_eq!(due(&p, &live("sermon", 30, 30 * 60_000 - 595_000, false), &mut fired).len(), 1);
        // The host kept `fired` (saved): the same moment seen again sends nothing.
        let mut restarted = fired.clone();
        assert!(due(&p, &live("sermon", 30, 30 * 60_000 - 594_000, false), &mut restarted).is_empty());
        // Another event has its own thresholds.
        assert_eq!(due(&p, &live("worship", 30, 20 * 60_000 - 595_000, false), &mut restarted)[0].reference, "Worship");
    }

    #[test]
    fn no_policy_or_too_little_known_sends_nothing() {
        let mut fired = BTreeSet::new();
        assert!(due(&ReminderPolicy::default(), &live("sermon", 30, 30 * 60_000 - 599_000, false), &mut fired).is_empty(), "off by default");
        assert!(due(&ReminderPolicy { thresholds_min: vec![10], to: vec![], urgent: false }, &live("sermon", 30, 30 * 60_000 - 599_000, false), &mut fired).is_empty(), "nobody to tell");
        assert!(due(&policy(), &live("sermon", 0, 1000, false), &mut fired).is_empty(), "no planned length");
        assert!(due(&policy(), r#"{"v":1}"#, &mut fired).is_empty());
        let p = ReminderPolicy { thresholds_min: vec![0, 999, 5, 5, 1, 2, 3, 4, 6, 7], to: vec![" ".into(), "role:stage".into()], urgent: false }.checked();
        assert_eq!((p.thresholds_min, p.to), (vec![7, 6, 5, 4, 3, 2], vec!["role:stage".to_string()]));
    }
}
