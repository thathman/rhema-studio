//! The companion's link to the church's Rhema (#209): the same commands the studio's join store
//! calls (`join_pair`, `join_me`, `join_cameras`, `join_tally`, `join_connect`…), but always over the host's
//! secure page with its certificate pinned. Before pairing, `join_host_certificate` reads the
//! host's certificate and the window shows its fingerprint (the host shows the same one in
//! Settings → Remote control); pairing pins it, in companion.json in this app's data folder.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rhema_join::host::Host;
use rhema_join::pin;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::watch;

/// The host this computer paired with: its address (as typed or found), the port of its secure
/// page, and its certificate's fingerprint (the host's local CA, SHA-256).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Paired {
    pub address: String,
    pub tls_port: u16,
    pub certificate: String,
}

/// companion.json: what this computer keeps about its host.
#[derive(Serialize, Deserialize, Default, Clone)]
struct Kept {
    host: Option<Paired>,
}

#[derive(Default)]
pub struct Link {
    /// The certificate shown before pairing, waiting for the code.
    shown: Mutex<Option<Paired>>,
    /// The paired host, once companion.json has been read.
    paired: Mutex<Kept>,
    /// companion.json has been read.
    read: std::sync::atomic::AtomicBool,
    /// Stops following the host's Live State.
    stop: Mutex<Option<watch::Sender<bool>>>,
}

fn kept_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("companion.json"))
}

/// The paired host in companion.json; none when there is no file or it cannot be read.
fn read_kept(path: &Path) -> Option<Paired> {
    let kept: Kept = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    kept.host.filter(|p| pin::valid_fingerprint(&p.certificate))
}

/// Keep the paired host: written beside and then moved in place, so a crash never leaves half a file.
fn write_kept(path: &Path, host: Option<&Paired>) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(&serde_json::json!({ "host": host })).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// The same address, however it was typed.
fn same(a: &str, b: &str) -> bool {
    a.trim().eq_ignore_ascii_case(b.trim())
}

/// The pinned host for `address`, or why there is none.
fn pinned_for(paired: Option<&Paired>, address: &str) -> Result<Host, String> {
    match paired.filter(|p| same(&p.address, address)) {
        Some(p) => pin::pinned_host(&p.address, p.tls_port, &p.certificate),
        None => Err(format!("This computer has not paired with {} yet: pair again with the code on the host's screen", address.trim())),
    }
}

impl Link {
    fn paired(&self, app: &AppHandle) -> Option<Paired> {
        let mut cache = self.paired.lock().ok()?;
        if !self.read.swap(true, std::sync::atomic::Ordering::SeqCst) {
            cache.host = kept_path(app).ok().and_then(|p| read_kept(&p));
        }
        cache.host.clone()
    }

    fn host(&self, app: &AppHandle, address: &str) -> Result<Host, String> {
        pinned_for(self.paired(app).as_ref(), address)
    }
}

/// Read the certificate of the host at `address` (host:port of its Remote control), checked to be
/// signed by the host's own certificate authority: shown before pairing, pinned by `join_pair`.
pub async fn read_certificate(address: &str) -> Result<Paired, String> {
    let tls_port = pin::tls_port_of(address)?;
    let certificate = pin::read_host_ca(address, tls_port).await?;
    Ok(Paired { address: address.trim().to_string(), tls_port, certificate })
}

#[tauri::command]
pub async fn join_host_certificate(link: State<'_, Link>, address: String) -> Result<Paired, String> {
    let p = read_certificate(&address).await?;
    if let Ok(mut shown) = link.shown.lock() {
        *shown = Some(p.clone());
    }
    Ok(p)
}

/// The host this computer is paired with, for the window to show its certificate.
#[tauri::command]
pub fn join_paired_host(app: AppHandle, link: State<'_, Link>) -> Option<Paired> {
    link.paired(&app)
}

/// Pair with the host using the code on its screen, over its secure page with the certificate the
/// window showed (read now if it showed none), and keep that certificate pinned.
#[tauri::command]
pub async fn join_pair(app: AppHandle, link: State<'_, Link>, address: String, code: String, name: String, role: Option<String>) -> Result<String, String> {
    let shown = link.shown.lock().ok().and_then(|s| s.clone()).filter(|p| same(&p.address, &address));
    let p = match shown {
        Some(p) => p,
        None => read_certificate(&address).await?,
    };
    let host = pin::pinned_host(&p.address, p.tls_port, &p.certificate)?;
    let token = rhema_join::host::pair(&host, &code, &name, role.as_deref()).await?;
    write_kept(&kept_path(&app)?, Some(&p)).map_err(|e| format!("Paired, but this computer could not keep the host's certificate: {e}"))?;
    if let Ok(mut cache) = link.paired.lock() {
        cache.host = Some(p);
        link.read.store(true, std::sync::atomic::Ordering::SeqCst);
    }
    log::info!("Paired with the host at {}", address.trim());
    Ok(token)
}

#[tauri::command]
pub async fn join_me(app: AppHandle, link: State<'_, Link>, address: String, token: String) -> Result<serde_json::Value, String> {
    let host = link.host(&app, &address)?;
    rhema_join::host::me(&host, &token).await
}

#[tauri::command]
pub async fn join_cameras(app: AppHandle, link: State<'_, Link>, address: String, token: String) -> Result<serde_json::Value, String> {
    let host = link.host(&app, &address)?;
    rhema_join::host::cameras(&host, &token).await
}

#[tauri::command]
pub async fn join_tally(app: AppHandle, link: State<'_, Link>, address: String, token: String, tally: serde_json::Value) -> Result<(), String> {
    let host = link.host(&app, &address)?;
    rhema_join::host::tally(&host, &token, &tally).await
}

/// Follow the host's Live State ("join:live", "join:state"), reconnecting by itself.
#[tauri::command]
pub fn join_connect(app: AppHandle, link: State<'_, Link>, address: String, token: String) -> Result<(), String> {
    let host = link.host(&app, &address)?;
    let (tx, rx) = watch::channel(false);
    if let Some(old) = link.stop.lock().map_err(|e| e.to_string())?.replace(tx) {
        let _ = old.send(true);
    }
    tauri::async_runtime::spawn(rhema_join::host::follow_live(host, token, rx, move |event, payload| {
        let _ = app.emit(event, payload);
    }));
    Ok(())
}

#[tauri::command]
pub fn join_disconnect(link: State<'_, Link>) -> Result<(), String> {
    if let Some(stop) = link.stop.lock().map_err(|e| e.to_string())?.take() {
        let _ = stop.send(true);
    }
    Ok(())
}

/// The Rhema hosts on this network (about two and a half seconds).
#[tauri::command]
pub async fn host_discover() -> Result<Vec<rhema_join::discover::Found>, String> {
    rhema_join::discover::discover_hosts().await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paired() -> Paired {
        Paired { address: "192.168.1.20:8080".into(), tls_port: 8081, certificate: "ab".repeat(32) }
    }

    #[test]
    fn the_paired_host_is_kept_and_read_back_and_a_damaged_file_is_none() {
        let dir = std::env::temp_dir().join(format!("rhema-companion-kept-{}", std::process::id()));
        let path = dir.join("companion.json");
        assert_eq!(read_kept(&path), None, "no file yet");
        write_kept(&path, Some(&paired())).unwrap();
        assert_eq!(read_kept(&path), Some(paired()));
        assert!(std::fs::read_to_string(&path).unwrap().contains("\"tlsPort\": 8081"));
        std::fs::write(&path, r#"{"host":{"address":"x:1","tlsPort":2,"certificate":"not hex"}}"#).unwrap();
        assert_eq!(read_kept(&path), None, "a certificate that is not a fingerprint");
        std::fs::write(&path, "not json").unwrap();
        assert_eq!(read_kept(&path), None);
        write_kept(&path, None).unwrap();
        assert_eq!(read_kept(&path), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_the_paired_host_is_talked_to_and_only_over_its_secure_page() {
        let host = pinned_for(Some(&paired()), " 192.168.1.20:8080 ").unwrap();
        assert_eq!(host.url("/api/v1/me"), "https://192.168.1.20:8081/api/v1/me");
        let other = pinned_for(Some(&paired()), "192.168.1.30:8080").unwrap_err();
        assert!(other.contains("pair again"), "{other}");
        assert!(pinned_for(None, "192.168.1.20:8080").unwrap_err().contains("pair again"));
    }

    #[tokio::test]
    async fn a_host_without_its_secure_page_is_not_paired_with() {
        // Nothing listens there at all.
        let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let err = read_certificate(&format!("127.0.0.1:{closed}")).await.unwrap_err();
        assert!(err.starts_with("Could not reach the host"), "{err}");
        assert!(read_certificate("not an address").await.is_err());
    }

    #[test]
    fn the_version_is_four_parts_and_matches_the_package() {
        assert_eq!(crate::VERSION, format!("{}.0", env!("CARGO_PKG_VERSION")));
    }
}
