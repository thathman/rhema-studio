//! Speech-to-text integration for the Rhema application.
//!
//! Provides real-time transcription via multiple providers:
//! - **Deepgram** (cloud) — WebSocket streaming with keyword boosting
//! - **Whisper** (local) — offline inference via whisper.cpp
//! - **OpenAI Whisper** (cloud) — batched audio transcription API
//!
//! # Key types
//!
//! - [`SttProvider`] — trait for swappable STT backends
//! - [`DeepgramClient`] — Deepgram WebSocket/REST provider
//! - [`TranscriptEvent`] — streaming transcript events (partial, final, etc.)
//! - [`SttConfig`] — API configuration
//! - [`SttError`] — error type for STT operations
//!
//! # Feature flags
//!
//! - `rest-fallback` — enables REST API fallback client
//! - `openai` — enables OpenAI Whisper API provider
//! - `whisper` — enables local Whisper STT provider

pub mod deepgram;
pub mod error;
pub mod keyterms;
pub mod provider;
pub mod rest;
pub mod types;

#[cfg(feature = "openai")]
pub mod openai;

#[cfg(feature = "whisper")]
pub mod whisper;

pub use deepgram::DeepgramClient;
pub use error::SttError;
pub use keyterms::{bible_keyterms, bible_keyterms_for_language};
pub use provider::SttProvider;
pub use types::{SttConfig, TranscriptEvent, Word};

#[cfg(feature = "openai")]
pub use openai::OpenAiWhisperProvider;

#[cfg(feature = "whisper")]
pub use whisper::WhisperProvider;
