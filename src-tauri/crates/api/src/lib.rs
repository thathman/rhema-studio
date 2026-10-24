//! External API integrations for the Rhema application.
//!
//! Implements: OSC server, HTTP API (Axum).
//! Planned: `OpenAI` embeddings client.

pub mod cameras;
pub mod coerce;
pub mod command;
pub mod keys;
pub mod rate;
pub mod scene_edits;
pub mod dispatch;
pub mod error;
pub mod http;
pub mod osc;
pub mod tls;

pub use cameras::{new_camera_hub, valid_camera_name, CameraHub, CameraWatch, ObsTally, RouterTarget, SharedCameras, Tally, Watcher, COMPANION_PATH, PUBLISH_PREFIX, READ_PREFIX};
pub use coerce::{coerce_bool, coerce_f32_normalized, coerce_string, parse_osc};
pub use command::RemoteCommand;
pub use dispatch::{CommandDispatcher, CommandSink};
pub use error::CommandError;
pub use http::{set_app_version, start_http_server, FeedHub, FeedStatus, HttpConfig, HttpHandle, HttpStartResult, LiveHub, SharedFeeds, SharedLive, SharedStatus, SharedVoice, StatusSnapshot, TlsListener, VoiceHub, new_feed_hub, new_live_hub, new_voice_hub, new_shared_status};
pub use osc::{start_osc_listener, OscConfig, OscHandle, OscStartResult};
pub use keys::{check_key, close_pairing, hash_key, key_set_from, new_key_set, new_pairing_window, open_pairing, role_asked, try_pair, try_pair_as, KeyEntry, KeySet, PairOutcome, PairingWindow, Role};
