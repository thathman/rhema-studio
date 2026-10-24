//! Saved keys and passwords in the operating system's credential store (Windows Credential Manager,
//! macOS Keychain, Secret Service on Linux) instead of the plain settings file (RG-08). Each app
//! keeps ONE entry (a JSON object of strings) under its own name, so a system that asks before an
//! app reads the keychain asks once, not once per secret.

use keyring::Entry;

const ACCOUNT: &str = "settings-secrets";

fn entry(service: &str) -> Result<Entry, String> {
    Entry::new(service, ACCOUNT).map_err(|e| e.to_string())
}

/// Store `value` and read it back; true only when the store returned the same value, so the caller
/// may safely blank its own copy. An empty value deletes the entry.
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

/// The stored JSON, `None` when nothing is stored; an error when the store could not be read
/// (locked, unavailable), which the caller must not mistake for "empty".
pub fn get(service: &str) -> Result<Option<String>, String> {
    match entry(service)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Replace the stored JSON (empty deletes it). Must be a JSON object of strings.
pub fn set(service: &str, json: &str) -> Result<bool, String> {
    if !json.is_empty() {
        let v: serde_json::Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
        if !v.as_object().is_some_and(|o| o.values().all(serde_json::Value::is_string)) {
            return Err("secrets must be a JSON object of strings".into());
        }
    }
    set_verified(&entry(service)?, json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_app_keeps_its_own_entry_and_only_a_json_object_of_strings() {
        keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        assert!(set("Rhema Companion", "not json").is_err());
        assert!(set("Rhema Companion", "[1,2]").is_err());
        assert!(set("Rhema Companion", r#"{"a":1}"#).is_err());
        let e = entry("Rhema Companion").unwrap();
        assert_eq!(set_verified(&e, r#"{"joinToken":"t"}"#), Ok(true));
        assert_eq!(set_verified(&e, ""), Ok(true));
        assert_eq!(set_verified(&e, ""), Ok(true), "deleting nothing is fine");
    }
}
