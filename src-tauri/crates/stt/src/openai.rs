//! OpenAI Transcribe API STT provider.
//!
//! The transcription endpoint is request/response rather than a streaming
//! WebSocket, so audio is segmented with the same energy VAD used by local
//! Whisper and uploaded after each spoken utterance.

use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use crossbeam_channel::Receiver;
use tokio::sync::{mpsc, watch};

use crate::error::SttError;
use crate::provider::SttProvider;
use crate::types::TranscriptEvent;

const SAMPLE_RATE: u32 = 16_000;
const MIN_BUFFER_SAMPLES: usize = SAMPLE_RATE as usize;
// Keep unbroken speech chunks well below the transcription endpoint's 25 MB limit.
const MAX_BUFFER_SAMPLES: usize = SAMPLE_RATE as usize * 60 * 8;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(45);

/// OpenAI's transcription API accepts WAV files. Wrap the captured
/// mono PCM in a small WAV header so no external encoder is required.
fn pcm_to_wav(samples: &[i16]) -> Vec<u8> {
    let data_size = (samples.len() * 2) as u32;
    let mut wav = Vec::with_capacity(44 + data_size as usize);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_size).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16_u32.to_le_bytes()); // PCM fmt chunk size
    wav.extend_from_slice(&1_u16.to_le_bytes()); // PCM format
    wav.extend_from_slice(&1_u16.to_le_bytes()); // mono
    wav.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    wav.extend_from_slice(&(SAMPLE_RATE * 2).to_le_bytes()); // byte rate
    wav.extend_from_slice(&2_u16.to_le_bytes()); // block align
    wav.extend_from_slice(&16_u16.to_le_bytes()); // bits per sample
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_size.to_le_bytes());
    for sample in samples {
        wav.extend_from_slice(&sample.to_le_bytes());
    }
    wav
}

fn append_text_field(body: &mut Vec<u8>, boundary: &str, name: &str, value: &str) {
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n"
        )
        .as_bytes(),
    );
}

/// Yoruba is left to automatic detection until OpenAI documents a supported
/// Yorùbá hint for the current transcription model.
fn api_language_hint(language: Option<&str>) -> Option<&str> {
    match language {
        Some("en") => Some("en"),
        Some("yo") | None => None,
        Some(other) => Some(other),
    }
}

fn format_request_error(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        return format!("OpenAI transcription timed out before the API responded: {error}");
    }

    if error.is_connect() {
        return format!("OpenAI transcription could not connect to api.openai.com: {error}");
    }

    format!("OpenAI request failed: {error}")
}

async fn cancellable<T>(
    cancel: &mut watch::Receiver<bool>,
    operation: impl Future<Output = T>,
) -> Option<T> {
    if *cancel.borrow() {
        return None;
    }

    tokio::select! {
        biased;
        changed = cancel.changed() => {
            let _ = changed;
            None
        }
        result = operation => Some(result),
    }
}

/// OpenAI Transcribe API provider. It emits final results after each VAD
/// utterance; the API does not provide interim tokens for a live stream.
pub struct OpenAiTranscribeProvider {
    api_key: String,
    language: Option<String>,
    cancelled: Arc<AtomicBool>,
    cancel_tx: watch::Sender<bool>,
}

impl OpenAiTranscribeProvider {
    pub fn new(api_key: String, language: Option<String>) -> Self {
        let (cancel_tx, _) = watch::channel(false);
        Self {
            api_key,
            language,
            cancelled: Arc::new(AtomicBool::new(false)),
            cancel_tx,
        }
    }

    async fn transcribe(
        &self,
        client: &reqwest::Client,
        samples: Vec<i16>,
    ) -> Result<String, SttError> {
        // Build multipart directly so this provider does not need reqwest's
        // optional multipart feature (and its extra runtime dependencies).
        let boundary = "rhema-openai-transcribe-boundary";
        let mut body = Vec::new();
        let wav = pcm_to_wav(&samples);
        body.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"rhema-speech.wav\"\r\nContent-Type: audio/wav\r\n\r\n"
            )
            .as_bytes(),
        );
        body.extend_from_slice(&wav);
        body.extend_from_slice(b"\r\n");
        append_text_field(&mut body, boundary, "model", "gpt-transcribe");
        append_text_field(&mut body, boundary, "response_format", "json");
        append_text_field(&mut body, boundary, "temperature", "0");
        if let Some(language) = api_language_hint(self.language.as_deref()) {
            append_text_field(&mut body, boundary, "languages[]", language);
        }
        body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());

        let response = client
            .post("https://api.openai.com/v1/audio/transcriptions")
            .bearer_auth(&self.api_key)
            .header(
                reqwest::header::CONTENT_TYPE,
                format!("multipart/form-data; boundary={boundary}"),
            )
            .body(body)
            .send()
            .await
            .map_err(|e| SttError::ConnectionFailed(format_request_error(&e)))?;

        let status = response.status();
        if !status.is_success() {
            return Err(SttError::ConnectionFailed(format!(
                "OpenAI transcription API returned {status}"
            )));
        }
        let body = response
            .text()
            .await
            .map_err(|e| SttError::ParseError(format!("failed to read OpenAI response: {e}")))?;

        let json: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| SttError::ParseError(format!("failed to parse OpenAI response: {e}")))?;
        let transcript = json
            .get("text")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();

        Ok(transcript)
    }
}

impl std::fmt::Debug for OpenAiTranscribeProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OpenAiTranscribeProvider")
            .field("language", &self.language)
            .finish_non_exhaustive()
    }
}

#[async_trait::async_trait]
impl SttProvider for OpenAiTranscribeProvider {
    async fn start(
        &self,
        audio_rx: Receiver<Vec<i16>>,
        event_tx: mpsc::Sender<TranscriptEvent>,
    ) -> Result<(), SttError> {
        if self.api_key.is_empty() {
            return Err(SttError::ApiKeyMissing);
        }

        let _ = event_tx.send(TranscriptEvent::Connected).await;
        let (chunk_tx, mut chunk_rx) = mpsc::channel::<Vec<i16>>(4);
        let cancelled = self.cancelled.clone();
        let vad_event_tx = event_tx.clone();
        let vad_handle = tokio::task::spawn_blocking(move || {
            use rhema_audio::{AudioFrame, Vad, VadConfig, VadTransition};

            let vad_config = VadConfig {
                silence_threshold: 0.01,
                frame_threshold: 0.005,
                min_voice_frames: 6,
                ..VadConfig::default()
            };
            let mut vad = Vad::new(vad_config);
            let mut audio_buffer = Vec::new();

            let flush = |buffer: &mut Vec<i16>| {
                if buffer.len() >= MIN_BUFFER_SAMPLES {
                    let _ = chunk_tx.blocking_send(std::mem::take(buffer));
                } else {
                    buffer.clear();
                }
            };

            loop {
                if cancelled.load(Ordering::SeqCst) {
                    audio_buffer.clear();
                    break;
                }

                match audio_rx.recv_timeout(Duration::from_millis(50)) {
                    Ok(samples) => {
                        if cancelled.load(Ordering::SeqCst) {
                            audio_buffer.clear();
                            break;
                        }
                        let result = vad.process(&AudioFrame {
                            samples,
                            timestamp_ms: 0,
                        });
                        if let Some(transition) = result.transition {
                            match transition {
                                VadTransition::SpeechStarted => {
                                    let _ =
                                        vad_event_tx.blocking_send(TranscriptEvent::SpeechStarted);
                                }
                                VadTransition::SpeechEnded => flush(&mut audio_buffer),
                            }
                        }
                        for frame in result.frames {
                            let mut offset = 0;
                            while offset < frame.samples.len() {
                                let remaining = MAX_BUFFER_SAMPLES - audio_buffer.len();
                                let take = remaining.min(frame.samples.len() - offset);
                                audio_buffer
                                    .extend_from_slice(&frame.samples[offset..offset + take]);
                                offset += take;
                                if audio_buffer.len() == MAX_BUFFER_SAMPLES {
                                    flush(&mut audio_buffer);
                                }
                            }
                        }
                    }
                    Err(crossbeam_channel::RecvTimeoutError::Timeout) => {}
                    Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
                        if cancelled.load(Ordering::SeqCst) {
                            audio_buffer.clear();
                        } else {
                            flush(&mut audio_buffer);
                        }
                        break;
                    }
                }
            }
        });

        let client = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|error| SttError::ConnectionFailed(format_request_error(&error)))?;
        let mut cancel_rx = self.cancel_tx.subscribe();
        loop {
            let Some(samples) = cancellable(&mut cancel_rx, chunk_rx.recv()).await else {
                break;
            };
            let Some(samples) = samples else {
                break;
            };
            let started = std::time::Instant::now();
            let Some(result) = cancellable(&mut cancel_rx, self.transcribe(&client, samples)).await
            else {
                break;
            };
            match result {
                Ok(transcript) => {
                    log::info!("[OpenAI Transcribe] Completed in {:?}", started.elapsed());
                    if !transcript.is_empty() {
                        let _ = event_tx
                            .send(TranscriptEvent::Final {
                                transcript,
                                words: Vec::new(),
                                confidence: 0.0,
                                speech_final: true,
                            })
                            .await;
                    }
                    let _ = event_tx.send(TranscriptEvent::UtteranceEnd).await;
                }
                Err(error) => {
                    let message = error.to_string();
                    log::error!("[OpenAI Transcribe] {message}");
                    let _ = event_tx.send(TranscriptEvent::Error(message)).await;
                    break;
                }
            }
        }

        // Drop queued chunks before joining the VAD worker so a full bounded
        // channel cannot keep its blocking_send alive after Stop.
        drop(chunk_rx);
        let _ = vad_handle.await;
        let _ = event_tx.send(TranscriptEvent::Disconnected).await;
        Ok(())
    }

    fn stop(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.cancel_tx.send_replace(true);
    }

    fn name(&self) -> &'static str {
        "openai-transcribe"
    }
}

#[cfg(test)]
mod tests {
    use super::{
        api_language_hint, cancellable, pcm_to_wav, OpenAiTranscribeProvider, MAX_BUFFER_SAMPLES,
        SAMPLE_RATE,
    };
    use crate::provider::SttProvider;
    use std::future::pending;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use tokio::sync::mpsc;

    #[test]
    fn omits_unsupported_yoruba_language_hint() {
        assert_eq!(api_language_hint(Some("yo")), None);
    }

    #[test]
    fn keeps_english_language_hint() {
        assert_eq!(api_language_hint(Some("en")), Some("en"));
    }

    #[test]
    fn wraps_pcm_as_mono_16khz_wav() {
        let wav = pcm_to_wav(&[1, -2]);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(&wav[12..16], b"fmt ");
        assert_eq!(&wav[36..40], b"data");
        assert_eq!(u32::from_le_bytes(wav[40..44].try_into().unwrap()), 4);
        assert_eq!(&wav[44..], &[1, 0, 254, 255]);
    }

    #[test]
    fn upload_buffer_stays_below_the_api_file_limit() {
        const API_FILE_LIMIT_BYTES: usize = 25 * 1024 * 1024;
        assert_eq!(SAMPLE_RATE, 16_000);
        assert!(MAX_BUFFER_SAMPLES * 2 + 44 < API_FILE_LIMIT_BYTES);
    }

    #[tokio::test]
    async fn stop_drops_an_in_flight_upload_future() {
        struct DropCounter(Arc<AtomicUsize>);
        impl Drop for DropCounter {
            fn drop(&mut self) {
                self.0.fetch_add(1, Ordering::SeqCst);
            }
        }

        let provider = OpenAiTranscribeProvider::new("test-key".into(), None);
        let mut cancel_rx = provider.cancel_tx.subscribe();
        let dropped = Arc::new(AtomicUsize::new(0));
        let request = {
            let dropped = dropped.clone();
            async move {
                let _guard = DropCounter(dropped);
                pending::<()>().await;
            }
        };
        let request_task = tokio::spawn(async move { cancellable(&mut cancel_rx, request).await });
        tokio::task::yield_now().await;
        provider.stop();

        assert!(request_task.await.unwrap().is_none());
        assert_eq!(dropped.load(Ordering::SeqCst), 1);

        let mut cancel_rx = provider.cancel_tx.subscribe();
        let (chunk_tx, mut chunk_rx) = mpsc::channel(1);
        chunk_tx.try_send(vec![1, 2, 3]).unwrap();
        assert!(cancellable(&mut cancel_rx, chunk_rx.recv()).await.is_none());
        assert_eq!(chunk_rx.try_recv().unwrap(), vec![1, 2, 3]);
    }
}
