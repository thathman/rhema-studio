//! What this computer is and how it is coping (#243 G13, AC.5): its cores and memory, which the
//! app turns into soft limits on outputs, NDI senders, feeds and cameras, and while Show health is
//! open its CPU load, memory, heat and network links. Everything is read on this computer; nothing
//! here goes on the network.

use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use sysinfo::System;

/// The computer's size, read once by the app for its capacity limits.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineInfo {
    /// Logical cores (hyper-threads count).
    pub cores: usize,
    /// Physical cores, when the system says.
    pub physical_cores: Option<usize>,
    pub memory_total_mb: u64,
    pub os: &'static str,
    pub arch: &'static str,
}

/// One network link that is up: Wi-Fi or a cable, and its speed when the system says.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetLink {
    pub name: String,
    /// "wifi", "wired" or "other".
    pub kind: &'static str,
    /// Megabits a second, when the system reports it.
    pub speed_mbps: Option<u64>,
    /// It has an IPv4 address (it is on a network, not only plugged in).
    pub has_address: bool,
}

/// How the computer is doing now.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineHealth {
    /// Whole-computer CPU load, 0–100.
    pub cpu_percent: f32,
    pub memory_used_mb: u64,
    pub memory_total_mb: u64,
    /// macOS (Intel): the % of full speed the computer allows itself to keep cool; 100 = not slowed.
    /// None where the system does not report it (Apple silicon, Linux, Windows).
    pub cpu_speed_limit: Option<u8>,
    /// Links that are up; None where Rhema cannot list them on this system.
    pub network: Option<Vec<NetLink>>,
}

const MB: u64 = 1024 * 1024;

fn system() -> &'static Mutex<System> {
    static SYSTEM: OnceLock<Mutex<System>> = OnceLock::new();
    SYSTEM.get_or_init(|| Mutex::new(System::new()))
}

#[tauri::command]
pub fn machine_info() -> MachineInfo {
    let mut sys = System::new();
    sys.refresh_memory();
    MachineInfo {
        cores: std::thread::available_parallelism().map_or(1, std::num::NonZeroUsize::get),
        physical_cores: sys.physical_core_count(),
        memory_total_mb: sys.total_memory() / MB,
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
    }
}

/// CPU load needs two readings apart; the first call takes the second one a moment later.
#[tauri::command]
pub async fn machine_health() -> Result<MachineHealth, String> {
    let first = {
        let mut sys = system().lock().map_err(|e| e.to_string())?;
        let first = sys.cpus().is_empty();
        sys.refresh_cpu_usage();
        first
    };
    if first {
        tokio::time::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL.max(Duration::from_millis(250))).await;
    }
    let (cpu_percent, memory_used_mb, memory_total_mb) = {
        let mut sys = system().lock().map_err(|e| e.to_string())?;
        if first {
            sys.refresh_cpu_usage();
        }
        sys.refresh_memory();
        (sys.global_cpu_usage(), sys.used_memory() / MB, sys.total_memory() / MB)
    };
    let (cpu_speed_limit, network) = tauri::async_runtime::spawn_blocking(|| (cpu_speed_limit(), network_links()))
        .await
        .map_err(|e| e.to_string())?;
    Ok(MachineHealth { cpu_percent, memory_used_mb, memory_total_mb, cpu_speed_limit, network })
}

/// `pmset -g therm` prints `CPU_Speed_Limit = 100` on Intel Macs; Apple silicon prints no limit.
fn parse_speed_limit(text: &str) -> Option<u8> {
    text.lines().find_map(|line| {
        let (key, value) = line.split_once('=')?;
        if key.trim() != "CPU_Speed_Limit" {
            return None;
        }
        value.trim().parse::<u8>().ok().filter(|v| *v <= 100)
    })
}

#[cfg(target_os = "macos")]
fn cpu_speed_limit() -> Option<u8> {
    let out = std::process::Command::new("/usr/bin/pmset").args(["-g", "therm"]).output().ok()?;
    parse_speed_limit(&String::from_utf8_lossy(&out.stdout))
}

#[cfg(not(target_os = "macos"))]
fn cpu_speed_limit() -> Option<u8> {
    None
}

/// `networksetup -listallhardwareports`: each "Hardware Port: Wi-Fi" is followed by its "Device: en0".
fn parse_hardware_ports(text: &str) -> Vec<(String, String)> {
    let mut ports = Vec::new();
    let mut port: Option<String> = None;
    for line in text.lines() {
        if let Some(p) = line.strip_prefix("Hardware Port:") {
            port = Some(p.trim().to_owned());
        } else if let (Some(d), Some(p)) = (line.strip_prefix("Device:"), port.as_ref()) {
            ports.push((d.trim().to_owned(), p.clone()));
            port = None;
        }
    }
    ports
}

/// Wi-Fi or a cable, from the port's name (macOS) or whether the device is wireless (Linux).
fn link_kind(port: &str) -> &'static str {
    let p = port.to_ascii_lowercase();
    if p.contains("wi-fi") || p.contains("airport") || p.contains("wlan") || p.contains("wireless") {
        "wifi"
    } else if p.contains("ethernet") || p.contains("lan") || p.contains("thunderbolt") || p.contains("usb") {
        "wired"
    } else {
        "other"
    }
}

#[cfg(target_os = "macos")]
fn network_links() -> Option<Vec<NetLink>> {
    use std::collections::BTreeMap;
    use std::ffi::CStr;

    // The port names do not change while Rhema runs: asked once.
    static PORTS: OnceLock<Vec<(String, String)>> = OnceLock::new();
    let ports = PORTS.get_or_init(|| {
        std::process::Command::new("/usr/sbin/networksetup")
            .arg("-listallhardwareports")
            .output()
            .map(|o| parse_hardware_ports(&String::from_utf8_lossy(&o.stdout)))
            .unwrap_or_default()
    });

    struct Seen {
        running: bool,
        speed: Option<u64>,
        has_address: bool,
    }
    let mut seen: BTreeMap<String, Seen> = BTreeMap::new();
    let mut list: *mut libc::ifaddrs = std::ptr::null_mut();
    // SAFETY: getifaddrs fills `list` with a linked list that freeifaddrs releases below; each
    // entry is only read while the list is alive.
    unsafe {
        if libc::getifaddrs(&mut list) != 0 {
            return None;
        }
        let mut at = list;
        while !at.is_null() {
            let entry = &*at;
            at = entry.ifa_next;
            if entry.ifa_name.is_null() {
                continue;
            }
            let name = CStr::from_ptr(entry.ifa_name).to_string_lossy().into_owned();
            // Real ports only: not loopback, tunnels, AirDrop or bridges.
            if !name.starts_with("en") {
                continue;
            }
            let flags = entry.ifa_flags;
            let running = flags & (libc::IFF_UP as u32) != 0 && flags & (libc::IFF_RUNNING as u32) != 0;
            let s = seen.entry(name).or_insert(Seen { running: false, speed: None, has_address: false });
            s.running |= running;
            if entry.ifa_addr.is_null() {
                continue;
            }
            let family = i32::from((*entry.ifa_addr).sa_family);
            if family == libc::AF_INET {
                s.has_address = true;
            } else if family == libc::AF_LINK && !entry.ifa_data.is_null() {
                let data = &*entry.ifa_data.cast::<libc::if_data>();
                if data.ifi_baudrate > 0 {
                    s.speed = Some(u64::from(data.ifi_baudrate) / 1_000_000);
                }
            }
        }
        libc::freeifaddrs(list);
    }
    Some(
        seen.into_iter()
            .filter(|(_, s)| s.running && s.has_address)
            .map(|(name, s)| {
                let port = ports.iter().find(|(d, _)| *d == name).map_or("", |(_, p)| p.as_str());
                let kind = if port.is_empty() { "other" } else { link_kind(port) };
                NetLink { name: if port.is_empty() { name } else { port.to_owned() }, kind, speed_mbps: s.speed.filter(|v| *v > 0), has_address: s.has_address }
            })
            .collect(),
    )
}

#[cfg(target_os = "linux")]
fn network_links() -> Option<Vec<NetLink>> {
    let dir = std::fs::read_dir("/sys/class/net").ok()?;
    let mut links: Vec<NetLink> = dir
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            // A real port has a device behind it; loopback, bridges and tunnels do not.
            if !path.join("device").exists() {
                return None;
            }
            let state = std::fs::read_to_string(path.join("operstate")).unwrap_or_default();
            if state.trim() != "up" {
                return None;
            }
            let wireless = path.join("wireless").exists() || path.join("phy80211").exists();
            let speed = std::fs::read_to_string(path.join("speed")).ok().and_then(|s| s.trim().parse::<i64>().ok()).and_then(|v| u64::try_from(v).ok()).filter(|v| *v > 0);
            Some(NetLink { name, kind: if wireless { "wifi" } else { "wired" }, speed_mbps: speed, has_address: true })
        })
        .collect();
    links.sort_by(|a, b| a.name.cmp(&b.name));
    Some(links)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn network_links() -> Option<Vec<NetLink>> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_speed_limit_from_pmset() {
        let intel = "Note: No thermal warning level has been recorded\n2026-10-24 CPU Power notify\n\tCPU_Scheduler_Limit \t= 100\n\tCPU_Available_CPUs \t= 8\n\tCPU_Speed_Limit \t= 72\n";
        assert_eq!(parse_speed_limit(intel), Some(72));
        assert_eq!(parse_speed_limit("Note: No thermal warning level has been recorded\n"), None);
        assert_eq!(parse_speed_limit("CPU_Speed_Limit = 250"), None);
    }

    #[test]
    fn pairs_each_port_with_its_device() {
        let text = "\nHardware Port: Thunderbolt Bridge\nDevice: bridge0\nEthernet Address: 82:75\n\nHardware Port: Wi-Fi\nDevice: en0\nEthernet Address: 14:7d\n\nHardware Port: USB 10/100/1000 LAN\nDevice: en5\n";
        assert_eq!(
            parse_hardware_ports(text),
            vec![("bridge0".into(), "Thunderbolt Bridge".into()), ("en0".into(), "Wi-Fi".into()), ("en5".into(), "USB 10/100/1000 LAN".into())]
        );
    }

    #[test]
    fn tells_wifi_from_a_cable() {
        assert_eq!(link_kind("Wi-Fi"), "wifi");
        assert_eq!(link_kind("AirPort"), "wifi");
        assert_eq!(link_kind("USB 10/100/1000 LAN"), "wired");
        assert_eq!(link_kind("Thunderbolt Ethernet Slot 1"), "wired");
        assert_eq!(link_kind("iPhone USB"), "wired");
        assert_eq!(link_kind("Bluetooth PAN"), "other");
    }

    #[test]
    fn reports_this_computer() {
        let info = machine_info();
        assert!(info.cores >= 1);
        assert!(info.memory_total_mb > 0);
    }
}
