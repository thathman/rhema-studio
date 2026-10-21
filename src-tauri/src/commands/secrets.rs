//! API keys, the remote-control key and the OBS password in the operating
//! system's credential store (Windows Credential Manager, macOS Keychain,
//! Secret Service on Linux) instead of the plain settings file (RELEASE-PLAN
//! RG-08 "API keys secured"). The frontend falls back to the settings file
//! when the store is unavailable, so nothing is ever lost.

use keyring::Entry;

const SERVICE: &str = "Rhema Studio";
/// The only names the frontend may read or write.
pub const NAMES: &[&str] = &["deepgramApiKey", "openaiApiKey", "claudeApiKey", "remoteSecret", "obsPassword"];

fn entry(name: &str) -> Result<Entry, String> {
    if !NAMES.contains(&name) {
        return Err(format!("unknown secret {name:?}"));
    }
    Entry::new(SERVICE, name).map_err(|e| e.to_string())
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

/// `None` when nothing is stored under `name`; an error when the store
/// could not be read (locked, unavailable), which the caller must not
/// mistake for "empty".
#[tauri::command(async)]
pub fn secret_get(name: String) -> Result<Option<String>, String> {
    match entry(&name)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command(async)]
pub fn secret_set(name: String, value: String) -> Result<bool, String> {
    set_verified(&entry(&name)?, &value)
}

/// Every stored secret, for the diagnostics export to redact.
pub fn stored_values() -> Vec<String> {
    NAMES
        .iter()
        .filter_map(|n| Entry::new(SERVICE, n).ok()?.get_password().ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_names_are_accepted() {
        assert!(entry("someOtherApp").is_err());
        assert!(entry("../deepgramApiKey").is_err());
    }

    #[test]
    fn a_value_is_verified_by_reading_it_back_and_empty_deletes() {
        keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
        let e = Entry::new(SERVICE, "deepgramApiKey").unwrap();
        assert_eq!(set_verified(&e, "dg-1234567890"), Ok(true));
        assert_eq!(e.get_password().unwrap(), "dg-1234567890");
        assert_eq!(set_verified(&e, ""), Ok(true));
        assert!(matches!(e.get_password(), Err(keyring::Error::NoEntry)));
        assert_eq!(set_verified(&e, ""), Ok(true), "deleting nothing is fine");
    }
}
