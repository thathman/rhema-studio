//! External API integrations for the Rhema application.
//!
//! Implements: OSC server, HTTP API (Axum).
//! Planned: `OpenAI` embeddings client.

pub mod coerce;
pub mod command;
pub mod keys;
pub mod rate;
pub mod dispatch;
pub mod error;
pub mod http;
pub mod osc;

pub use coerce::{coerce_bool, coerce_f32_normalized, coerce_string, parse_osc};
pub use command::RemoteCommand;
pub use dispatch::{CommandDispatcher, CommandSink};
pub use error::CommandError;
pub use http::{start_http_server, HttpConfig, HttpHandle, HttpStartResult, SharedStatus, StatusSnapshot, new_shared_status};
pub use osc::{start_osc_listener, OscConfig, OscHandle, OscStartResult};
pub use keys::{check_key, close_pairing, hash_key, key_set_from, new_key_set, new_pairing_window, open_pairing, try_pair, KeyEntry, KeySet, PairOutcome, PairingWindow, Role};
