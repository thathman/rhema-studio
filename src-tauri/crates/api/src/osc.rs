use std::net::UdpSocket;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use rosc::{OscPacket, OscMessage};

use crate::coerce::parse_osc;
use crate::command::RemoteCommand;
use crate::dispatch::{CommandDispatcher, CommandSink};
use crate::error::CommandError;
use crate::keys::{check_key, new_key_set, KeyEntry, KeySet};
use crate::peer::check_remote_key;
use crate::http::{new_live_hub, SharedLive};

/// Configuration for the OSC listener.
#[derive(Debug, Clone)]
pub struct OscConfig {
    pub port: u16,
    pub host: String,
    /// Paired devices and the shared key; empty means open to local/private peers only. Otherwise
    /// every message must carry a token as its first string argument.
    pub keys: KeySet,
    /// Current host state, used to refuse Screens commands for removed/protected destinations.
    pub live: SharedLive,
}

impl Default for OscConfig {
    fn default() -> Self {
        Self {
            port: 8000,
            host: "0.0.0.0".into(),
            keys: new_key_set(),
            live: new_live_hub(),
        }
    }
}

/// Handle to a running OSC listener. Dropping or calling `stop()` shuts it down.
pub struct OscHandle {
    active: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl OscHandle {
    /// Signal the listener to stop and wait for the thread to finish.
    pub fn stop(&mut self) {
        self.active.store(false, Ordering::SeqCst);
        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }
    }

    /// Check if the listener is still running.
    pub fn is_active(&self) -> bool {
        self.active.load(Ordering::SeqCst)
    }
}

impl Drop for OscHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Result of attempting to start the OSC listener.
pub struct OscStartResult {
    pub handle: OscHandle,
    pub bound_port: u16,
}

/// Start the OSC UDP listener on a dedicated thread.
///
/// The listener binds to `config.host:config.port`, reads incoming UDP packets,
/// decodes OSC messages, parses them into `RemoteCommand` via `parse_osc`,
/// and dispatches through the provided `CommandSink`.
///
/// Returns a handle that can be used to stop the listener, plus the actual bound port.
///
/// # Errors
///
/// Returns `CommandError::DispatchFailed` if the UDP socket cannot bind.
#[expect(clippy::needless_pass_by_value, reason = "OscConfig is consumed to move fields into the spawned thread")]
pub fn start_osc_listener<S>(config: OscConfig, sink: Arc<S>) -> Result<OscStartResult, CommandError>
where
    S: CommandSink + 'static,
{
    let bind_addr = format!("{}:{}", config.host, config.port);

    let socket = UdpSocket::bind(&bind_addr).map_err(|e| {
        CommandError::DispatchFailed(format!("Failed to bind OSC on {bind_addr}: {e}"))
    })?;

    let bound_port = socket.local_addr().map(|a| a.port()).unwrap_or(config.port);

    // Non-blocking with a short timeout so we can check the active flag
    socket
        .set_read_timeout(Some(Duration::from_millis(100)))
        .map_err(|e| CommandError::DispatchFailed(format!("Failed to set read timeout: {e}")))?;

    let active = Arc::new(AtomicBool::new(true));
    let thread_active = active.clone();
    let keys = config.keys.clone();
    let live = config.live.clone();
    let rate = crate::rate::RateLimiter::default();

    let thread = std::thread::Builder::new()
        .name("osc-listener".into())
        .spawn(move || {
            log::info!("OSC listener started on {bind_addr} (port {bound_port})");

            let mut buf = [0u8; 4096];

            while thread_active.load(Ordering::SeqCst) {
                let (size, src) = match socket.recv_from(&mut buf) {
                    Ok(result) => result,
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::TimedOut =>
                    {
                        // Timeout — loop back to check active flag
                        continue;
                    }
                    Err(e) => {
                        log::debug!("OSC recv error: {e}");
                        continue;
                    }
                };

                let packet = match rosc::decoder::decode_udp(&buf[..size]) {
                    Ok((_rest, packet)) => packet,
                    Err(e) => {
                        log::debug!("OSC decode error: {e:?}");
                        continue;
                    }
                };

                handle_packet(&packet, &*sink, &keys, &live, Some((&rate, src.ip())));
            }

            log::info!("OSC listener stopped");
        })
        .map_err(|e| CommandError::DispatchFailed(format!("Failed to spawn OSC thread: {e}")))?;

    Ok(OscStartResult {
        handle: OscHandle {
            active,
            thread: Some(thread),
        },
        bound_port,
    })
}

/// Recursively handle an OSC packet (messages and bundles).
/// Rate limit and sender, when the message came off the network.
type Limit<'a> = Option<(&'a crate::rate::RateLimiter, std::net::IpAddr)>;

fn handle_packet(packet: &OscPacket, sink: &dyn CommandSink, keys: &KeySet, live: &SharedLive, limit: Limit<'_>) {
    match packet {
        OscPacket::Message(msg) => handle_message_from_live(msg, sink, keys, Some(live), limit),
        OscPacket::Bundle(bundle) => {
            for content in &bundle.content {
                handle_packet(content, sink, keys, live, limit);
            }
        }
    }
}

#[cfg(test)]
fn handle_message(msg: &OscMessage, sink: &dyn CommandSink, keys: &KeySet) {
    handle_message_from(msg, sink, keys, None);
}

/// Parse a single OSC message and dispatch the resulting command. With a
/// secret set, the first argument must be that string; it is stripped
/// before parsing.
///
/// The rate limit is spent only after the key check, so packets spoofed
/// from a controller's address without the key cannot use up its
/// allowance; fader values (confidence, opacity) are exempt, since a fader
/// sends dozens a second and the last one must land.
#[cfg(test)]
fn handle_message_from(msg: &OscMessage, sink: &dyn CommandSink, keys: &KeySet, limit: Limit<'_>) {
    handle_message_from_live(msg, sink, keys, None, limit)
}

fn handle_message_from_live(msg: &OscMessage, sink: &dyn CommandSink, keys: &KeySet, live: Option<&SharedLive>, limit: Limit<'_>) {
    let presented = match msg.args.first() {
        Some(rosc::OscType::String(k)) => Some(k.as_str()),
        _ => None,
    };
    // One check: the set may change between two reads (a revoke on another thread).
    let checked = match limit {
        Some((_, peer)) => check_remote_key(keys, presented, peer),
        None => check_key(keys, presented),
    };
    let (args, entry): (&[rosc::OscType], Option<KeyEntry>) = match checked {
        Ok(None) => (&msg.args, None),
        Ok(Some(e)) => (&msg.args[1..], Some(e)),
        Err(reason) => {
            log::warn!("OSC message refused for {}: {reason}", msg.addr);
            return;
        }
    };
    match parse_osc(&msg.addr, args) {
        Ok(cmd) => {
            if let Some(e) = entry {
                if e.paused_for(&cmd) {
                    log::warn!("OSC command refused for {}: {} ({})", msg.addr, crate::keys::PAUSED_MESSAGE, e.name);
                    return;
                }
                if !e.allows(&cmd) {
                    let why = if e.role.allows(&cmd) { "output is outside the host-assigned Screens scope" } else { "role may present but not change settings" };
                    log::warn!("OSC command refused for {}: {} ({})", msg.addr, e.name, why);
                    return;
                }
                if e.role == crate::keys::Role::Screens
                    && KeyEntry::scene_output(&cmd).is_some_and(|output| {
                        !KeyEntry::is_congregation_output(live.and_then(|hub| hub.current()).as_deref(), output)
                    })
                {
                    log::warn!("OSC scene command refused for {}: output is missing or not a congregation output", e.name);
                    return;
                }
            }
            if let Some((rate, ip)) = limit {
                let fader = matches!(cmd, RemoteCommand::Opacity(_) | RemoteCommand::Confidence(_));
                if !fader && !rate.allow(ip) {
                    log::warn!("OSC command refused: too many from {ip}");
                    return;
                }
            }
            log::debug!("OSC command: {cmd}");
            if let Err(e) = CommandDispatcher::dispatch_as(&cmd, sink, "OSC") {
                log::warn!("OSC dispatch error for {}: {e}", msg.addr);
            }
        }
        Err(e) => {
            log::debug!("OSC parse error for {}: {e}", msg.addr);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct MockSink {
        commands: Mutex<Vec<String>>,
    }

    impl MockSink {
        fn new() -> Self {
            Self {
                commands: Mutex::new(Vec::new()),
            }
        }

        fn command_count(&self) -> usize {
            self.commands.lock().unwrap().len()
        }
    }

    impl CommandSink for MockSink {
        fn emit_event(&self, event: &str, _payload: &str) -> Result<(), CommandError> {
            // Commands only: the service log's record (remote:audit) is not a command.
            if event != "remote:audit" {
                self.commands.lock().unwrap().push(event.to_string());
            }
            Ok(())
        }

        fn invoke_backend(&self, action: &str, _args: &str) -> Result<(), CommandError> {
            self.commands.lock().unwrap().push(action.to_string());
            Ok(())
        }
    }

    #[test]
    fn osc_listener_binds_and_stops() {
        let sink = Arc::new(MockSink::new());
        let config = OscConfig {
            port: 0, // OS assigns a free port
            host: "127.0.0.1".into(),
            ..Default::default()
        };

        let mut result = start_osc_listener(config, sink).expect("should bind");
        assert!(result.bound_port > 0);
        assert!(result.handle.is_active());

        result.handle.stop();
        assert!(!result.handle.is_active());
    }

    #[test]
    fn osc_listener_requires_the_key_when_one_is_set() {
        let sink = Arc::new(MockSink::new());
        let config = OscConfig { port: 0, host: "127.0.0.1".into(), keys: crate::keys::key_set_from(&[("s3cret", "Shared key")]), live: new_live_hub() };
        let result_keys = config.keys.clone();
        let result = start_osc_listener(config, sink.clone()).expect("should bind");
        let port = result.bound_port;
        let send_socket = UdpSocket::bind("127.0.0.1:0").unwrap();
        let send = |args: Vec<rosc::OscType>| {
            let packet = rosc::OscPacket::Message(rosc::OscMessage { addr: "/rhema/next".into(), args });
            send_socket.send_to(&rosc::encoder::encode(&packet).unwrap(), format!("127.0.0.1:{port}")).unwrap();
        };
        send(vec![]);
        send(vec![rosc::OscType::String("nope".into())]);
        std::thread::sleep(Duration::from_millis(200));
        assert_eq!(sink.command_count(), 0, "no key, no command");
        send(vec![rosc::OscType::String("s3cret".into())]);
        std::thread::sleep(Duration::from_millis(200));
        assert_eq!(sink.command_count(), 1);
        // A present-only entry cannot change the theme but can press Next.
        keys_for_role_test(&result_keys, "tok");
        let send_to = |addr: &str, args: Vec<rosc::OscType>| {
            let packet = rosc::OscPacket::Message(rosc::OscMessage { addr: addr.into(), args });
            send_socket.send_to(&rosc::encoder::encode(&packet).unwrap(), format!("127.0.0.1:{port}")).unwrap();
        };
        send_to("/rhema/theme", vec![rosc::OscType::String("tok".into()), rosc::OscType::String("Dark".into())]);
        send_to("/rhema/next", vec![rosc::OscType::String("tok".into())]);
        std::thread::sleep(Duration::from_millis(200));
        assert_eq!(sink.command_count(), 2);
        let mut handle = result.handle;
        handle.stop();
    }

    #[test]
    fn unauthenticated_osc_is_limited_to_local_network_peers() {
        let sink = Arc::new(MockSink::new());
        let keys = new_key_set();
        let rate = crate::rate::RateLimiter::default();
        let message = OscMessage { addr: "/rhema/next".into(), args: vec![] };

        handle_message_from(&message, &*sink, &keys, Some((&rate, "8.8.8.8".parse().unwrap())));
        assert_eq!(sink.command_count(), 0, "an open listener refuses public-source commands");

        handle_message_from(&message, &*sink, &keys, Some((&rate, "192.168.1.40".parse().unwrap())));
        assert_eq!(sink.command_count(), 1, "legacy open control still works on a private LAN");

        let paired = crate::keys::key_set_from(&[("s3cret", "Desk")]);
        let keyed_message = OscMessage {
            addr: "/rhema/next".into(),
            args: vec![rosc::OscType::String("s3cret".into())],
        };
        handle_message_from(&keyed_message, &*sink, &paired, Some((&rate, "8.8.8.8".parse().unwrap())));
        assert_eq!(sink.command_count(), 2, "a valid paired key preserves authenticated remote control");
    }

    fn keys_for_role_test(keys: &KeySet, token: &str) {
        keys.write().unwrap().entries.push(KeyEntry { hash: crate::keys::hash_key(token), name: "phone".into(), role: crate::keys::Role::Present, paused: false, output_scope: Vec::new() });
    }

    #[test]
    fn osc_listener_receives_and_dispatches() {
        let sink = Arc::new(MockSink::new());
        let config = OscConfig {
            port: 0,
            host: "127.0.0.1".into(),
            ..Default::default()
        };

        let result = start_osc_listener(config, sink.clone()).expect("should bind");
        let port = result.bound_port;

        // Send an OSC message to the listener
        let send_socket = UdpSocket::bind("127.0.0.1:0").unwrap();
        let msg = rosc::OscMessage {
            addr: "/rhema/next".into(),
            args: vec![],
        };
        let packet = rosc::OscPacket::Message(msg);
        let encoded = rosc::encoder::encode(&packet).unwrap();
        send_socket
            .send_to(&encoded, format!("127.0.0.1:{port}"))
            .unwrap();

        // Give the listener thread time to process
        std::thread::sleep(Duration::from_millis(200));

        assert!(sink.command_count() > 0, "Should have received at least one command");

        // Clean up
        let mut handle = result.handle;
        handle.stop();
    }

    #[test]
    fn osc_listener_port_conflict_returns_error() {
        // Bind a port first
        let blocker = UdpSocket::bind("127.0.0.1:0").unwrap();
        let port = blocker.local_addr().unwrap().port();

        let sink = Arc::new(MockSink::new());
        let config = OscConfig {
            port,
            host: "127.0.0.1".into(),
            ..Default::default()
        };

        let result = start_osc_listener(config, sink);
        assert!(result.is_err(), "Should fail when port is already in use");
    }

    #[test]
    fn handle_message_dispatches_next() {
        let sink = MockSink::new();
        let msg = OscMessage {
            addr: "/rhema/next".into(),
            args: vec![],
        };
        handle_message(&msg, &sink, &new_key_set());
        assert_eq!(sink.command_count(), 1);
    }

    #[test]
    fn the_limit_counts_only_keyed_commands_and_spares_faders() {
        let sink = MockSink::new();
        let keys = crate::keys::key_set_from(&[("k3y-123", "deck")]);
        let rate = crate::rate::RateLimiter::new(1.0, 2.0);
        let ip: std::net::IpAddr = "192.168.1.30".parse().unwrap();
        let keyed = |addr: &str, extra: Vec<rosc::OscType>| OscMessage { addr: addr.into(), args: [vec![rosc::OscType::String("k3y-123".into())], extra].concat() };
        // Spoofed packets without the key spend nothing.
        for _ in 0..50 {
            handle_message_from(&OscMessage { addr: "/rhema/next".into(), args: vec![] }, &sink, &keys, Some((&rate, ip)));
        }
        assert_eq!(sink.command_count(), 0);
        handle_message_from(&keyed("/rhema/next", vec![]), &sink, &keys, Some((&rate, ip)));
        handle_message_from(&keyed("/rhema/next", vec![]), &sink, &keys, Some((&rate, ip)));
        handle_message_from(&keyed("/rhema/next", vec![]), &sink, &keys, Some((&rate, ip)));
        assert_eq!(sink.command_count(), 2, "burst of 2, the third refused");
        for i in 0..30u8 {
            handle_message_from(&keyed("/rhema/confidence", vec![rosc::OscType::Float(f32::from(i) / 30.0)]), &sink, &keys, Some((&rate, ip)));
        }
        assert_eq!(sink.command_count(), 32, "fader values all land");
    }

    #[test]
    fn handle_message_ignores_unknown_address() {
        let sink = MockSink::new();
        let msg = OscMessage {
            addr: "/foo/bar".into(),
            args: vec![],
        };
        handle_message(&msg, &sink, &new_key_set());
        assert_eq!(sink.command_count(), 0);
    }

    #[test]
    fn handle_packet_processes_bundle() {
        let sink = MockSink::new();
        let bundle = OscPacket::Bundle(rosc::OscBundle {
            timetag: rosc::OscTime { seconds: 0, fractional: 0 },
            content: vec![
                OscPacket::Message(OscMessage {
                    addr: "/rhema/next".into(),
                    args: vec![],
                }),
                OscPacket::Message(OscMessage {
                    addr: "/rhema/prev".into(),
                    args: vec![],
                }),
            ],
        });
        handle_packet(&bundle, &sink, &new_key_set(), &new_live_hub(), None);
        assert_eq!(sink.command_count(), 2);
    }

    #[test]
    fn screens_osc_commands_obey_output_scope_and_protected_destination_rules() {
        let sink = MockSink::new();
        let keys = new_key_set();
        let hash = crate::keys::hash_key("screen-token");
        keys.write().unwrap().entries.push(KeyEntry {
            hash,
            name: "Screens desk".into(),
            role: crate::keys::Role::Screens,
            paused: false,
            output_scope: vec!["sanctuary".into(), "stage".into()],
        });
        keys.write().unwrap().require_auth = true;
        let live = new_live_hub();
        live.publish(r#"{"outputs":[{"id":"sanctuary"},{"id":"stage","role":"stage"}]}"#.into());
        let send = |address: &str, output: &str| OscMessage {
            addr: address.into(),
            args: vec![
                rosc::OscType::String("screen-token".into()),
                rosc::OscType::String(output.into()),
                rosc::OscType::String("sermon".into()),
            ],
        };
        handle_message_from_live(&send("/rhema/take_scene", "sanctuary"), &sink, &keys, Some(&live), None);
        handle_message_from_live(&send("/rhema/take_scene", "stage"), &sink, &keys, Some(&live), None);
        handle_message_from_live(&send("/rhema/take_scene", "overflow"), &sink, &keys, Some(&live), None);
        assert_eq!(sink.command_count(), 1, "only the assigned current congregation output is accepted");
    }
}
