//! API keys, the remote-control key and the OBS password in the operating
//! system's credential store (Windows Credential Manager, macOS Keychain,
//! Secret Service on Linux) instead of the plain settings file (RELEASE-PLAN
//! RG-08 "API keys secured"). The frontend falls back to the settings file
//! when the store is unavailable, so nothing is ever lost.
//!
//! All secrets live in ONE entry (a JSON object), so a system that asks the
//! user before an app reads the keychain (macOS after an update) asks once,
//! not once per secret.

use keyring::Entry;

const SERVICE: &str = "Rhema Studio";
const ACCOUNT: &str = "settings-secrets";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())
}

/// Store `value` and read it back; true only when the store returned the
/// same value, so the caller may safely blank its own copy. An empty value
/// deletes the entry.
pub fn set_verified(entry: &Entry, value: &str) -> Result<bool, String> {
    if value.is_empty() {
        return match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(true),
            Err(e) => Err(e.to_string()),
        };
    }
    entry.set_password(value).map_err(|e| e.to_string())?;
    Ok(entry.get_password().map_err(|e| e.to_string())? == value)
}

/// The stored JSON, `None` when nothing is stored; an error when the store
/// could not be read (locked, unavailable), which the caller must not
/// mistake for "empty".
#[tauri::command(async)]
pub fn secrets_get() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Replace the stored JSON (empty deletes it). Must be a JSON object of strings.
#[tauri::command(async)]
pub fn secrets_set(json: String) -> Result<bool, String> {
    if !json.is_empty() {
        let v: serde_json::Value = serde_json::from_str(&json).map_err(|e| e.to_string())?;
        if !v.as_object().is_some_and(|o| o.values().all(serde_json::Value::is_string)) {
            return Err("secrets must be a JSON object of strings".into());
        }
    }
    set_verified(&entry()?, &json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_value_is_verified_by_reading_it_back_and_empty_deletes() {
        keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        let e = Entry::new(SERVICE, ACCOUNT).unwrap();
        assert_eq!(set_verified(&e, r#"{"deepgramApiKey":"dg-1234567890"}"#), Ok(true));
        assert_eq!(e.get_password().unwrap(), r#"{"deepgramApiKey":"dg-1234567890"}"#);
        assert_eq!(set_verified(&e, ""), Ok(true));
        assert!(matches!(e.get_password(), Err(keyring::Error::NoEntry)));
        assert_eq!(set_verified(&e, ""), Ok(true), "deleting nothing is fine");
    }

    #[test]
    fn only_a_json_object_of_strings_is_stored() {
        assert!(secrets_set("not json".into()).is_err());
        assert!(secrets_set("[1,2]".into()).is_err());
        assert!(secrets_set(r#"{"a":1}"#.into()).is_err());
    }
}
