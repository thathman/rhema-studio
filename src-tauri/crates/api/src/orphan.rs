//! A camera router left running by an earlier Rhema that did not close normally (#597): it keeps
//! the router's ports, so a new one cannot start. Only a router that is positively Rhema's own is
//! stopped: this program, started with this settings file (which lives in Rhema's own data folder),
//! and no longer anyone's child. Any other `MediaMTX` on the computer is left alone.

use std::path::Path;
use std::time::{Duration, Instant};

use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, Signal, System, UpdateKind};

/// Stop the routers an earlier Rhema left running with `program` and `config`; returns their
/// process numbers. Asks each to close, and ends it after three seconds if it has not.
pub fn end_orphaned_routers(program: &Path, config: &Path) -> Vec<u32> {
    let (Ok(program), Ok(config)) = (program.canonicalize(), config.canonicalize()) else {
        return Vec::new();
    };
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_exe(UpdateKind::Always).with_cmd(UpdateKind::Always));
    let ours: Vec<Pid> = sys
        .processes()
        .iter()
        .filter(|(_, p)| p.exe().and_then(|e| e.canonicalize().ok()).is_some_and(|e| e == program))
        .filter(|(_, p)| p.cmd().get(1).and_then(|c| Path::new(c).canonicalize().ok()).is_some_and(|c| c == config))
        // Still someone's child: another Rhema (or a person) runs it, so it is not left over.
        .filter(|(_, p)| p.parent().is_none_or(|parent| parent.as_u32() == 1 || sys.process(parent).is_none()))
        .map(|(pid, _)| *pid)
        .collect();
    for pid in &ours {
        if let Some(p) = sys.process(*pid) {
            log::warn!("camera router {pid} was left running by an earlier Rhema; closing it");
            if p.kill_with(Signal::Term).is_none() {
                p.kill();
            }
        }
    }
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        sys.refresh_processes(ProcessesToUpdate::Some(&ours), true);
        let left: Vec<Pid> = ours.iter().copied().filter(|pid| sys.process(*pid).is_some()).collect();
        if left.is_empty() {
            break;
        }
        if Instant::now() >= deadline {
            for pid in left {
                if let Some(p) = sys.process(pid) {
                    p.kill();
                }
            }
            std::thread::sleep(Duration::from_millis(200));
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    ours.iter().map(|p| p.as_u32()).collect()
}
