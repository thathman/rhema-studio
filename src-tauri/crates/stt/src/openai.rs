//! OpenAI Whisper API STT provider.
//!
//! The transcription endpoint is request/response rather than a streaming
//! WebSocket, so audio is segmented with the same energy VAD used by local
//! Whisper and uploaded after each spoken utterance.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use crossbeam_channel::Receiver;
use tokio::sync::mpsc;

use crate::error::SttError;
use crate::provider::SttProvider;
use crate::types::{TranscriptEvent, Word};

const SAMPLE_RATE: u32 = 16_000;
const MIN_BUFFER_SAMPLES: usize = SAMPLE_RATE as usize;

/// OpenAI's Whisper API accepts common audio containers. Wrap the captured
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

/// The OpenAI Whisper API does not accept `yo` as a `language` parameter.
/// Leaving the hint out lets the multilingual model auto-detect the spoken
/// language instead of rejecting the request before transcription starts.
fn api_language_hint(language: Option<&str>) -> Option<&str> {
    match language {
        Some("en") => Some("en"),
        Some("yo") | None => None,
        Some(other) => Some(other),
    }
}

fn format_request_error(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        return format!(
            "OpenAI request timed out before the API responded. Check your internet connection: {error}"
        );
    }

    if error.is_connect() {
        return format!(
            "OpenAI connection failed before the API responded. Check DNS, TLS, and internet access for api.openai.com: {error}"
        );
    }

    format!("OpenAI request failed: {error}")
}

/// OpenAI Whisper API provider. It emits final results after each VAD
/// utterance; the API does not provide interim tokens for a live stream.
pub struct OpenAiWhisperProvider {
    api_key: String,
    language: Option<String>,
    cancelled: Arc<AtomicBool>,
}

impl OpenAiWhisperProvider {
    pub fn new(api_key: String, language: Option<String>) -> Self {
        Self {
            api_key,
            language,
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    async fn transcribe(
        &self,
        client: &reqwest::Client,
        samples: Vec<i16>,
    ) -> Result<(String, Vec<Word>), SttError> {
        // Build multipart directly so this provider does not need reqwest's
        // optional multipart feature (and its extra runtime dependencies).
        let boundary = "rhema-openai-whisper-boundary";
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
        append_text_field(&mut body, boundary, "model", "whisper-1");
        append_text_field(&mut body, boundary, "response_format", "verbose_json");
        append_text_field(&mut body, boundary, "temperature", "0");
        if let Some(language) = api_language_hint(self.language.as_deref()) {
            append_text_field(&mut body, boundary, "language", language);
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
        let body = response
            .text()
            .await
            .map_err(|e| SttError::ParseError(format!("failed to read OpenAI response: {e}")))?;
        if !status.is_success() {
            return Err(SttError::ConnectionFailed(format!(
                "OpenAI Whisper API returned {status}: {body}"
            )));
        }

        let json: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| SttError::ParseError(format!("failed to parse OpenAI response: {e}")))?;
        let transcript = json
            .get("text")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();

        // The API does not expose the same confidence shape as Deepgram.
        // Preserve word timing when present and use a conservative result
        // confidence for the downstream detection merger.
        let words = json
            .get("words")
            .and_then(serde_json::Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| {
                        Some(Word {
                            text: item.get("word")?.as_str()?.to_string(),
                            start: item.get("start")?.as_f64()?,
                            end: item.get("end")?.as_f64()?,
                            confidence: 0.9,
                            punctuated_word: None,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok((transcript, words))
    }
}

impl std::fmt::Debug for OpenAiWhisperProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OpenAiWhisperProvider")
            .field("language", &self.language)
            .finish_non_exhaustive()
    }
}

#[async_trait::async_trait]
impl SttProvider for OpenAiWhisperProvider {
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
                    flush(&mut audio_buffer);
                    break;
                }

                match audio_rx.recv_timeout(Duration::from_millis(50)) {
                    Ok(samples) => {
                        let result = vad.process(&AudioFrame {
                            samples,
                            timestamp_ms: 0,
                        });
                        if let Some(transition) = result.transition {
                            match transition {
                                VadTransition::SpeechStarted => {
                                    let _ = vad_event_tx.blocking_send(TranscriptEvent::SpeechStarted);
                                }
                                VadTransition::SpeechEnded => flush(&mut audio_buffer),
                            }
                        }
                        for frame in result.frames {
                            audio_buffer.extend_from_slice(&frame.samples);
                        }
                    }
                    Err(crossbeam_channel::RecvTimeoutError::Timeout) => {}
                    Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
                        flush(&mut audio_buffer);
                        break;
                    }
                }
            }
        });

        let client = reqwest::Client::new();
        while let Some(samples) = chunk_rx.recv().await {
            let started = std::time::Instant::now();
            match self.transcribe(&client, samples).await {
                Ok((transcript, words)) => {
                    log::info!(
                        "[OpenAI Whisper] Transcribed in {:?}: {:?}",
                        started.elapsed(),
                        transcript
                    );
                    if !transcript.is_empty() {
                        let _ = event_tx
                            .send(TranscriptEvent::Final {
                                transcript,
                                words,
                                confidence: 0.9,
                                speech_final: true,
                            })
                            .await;
                    }
                    let _ = event_tx.send(TranscriptEvent::UtteranceEnd).await;
                }
                Err(error) => {
                    let message = error.to_string();
                    log::error!("[OpenAI Whisper] {message}");
                    let _ = event_tx.send(TranscriptEvent::Error(message)).await;
                    break;
                }
            }
        }

        let _ = vad_handle.await;
        let _ = event_tx.send(TranscriptEvent::Disconnected).await;
        Ok(())
    }

    fn stop(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    fn name(&self) -> &'static str {
        "openai-whisper"
    }
}

#[cfg(test)]
mod tests {
    use super::{api_language_hint, pcm_to_wav};

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
}
