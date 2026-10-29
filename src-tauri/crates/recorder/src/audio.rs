//! The approved mixer input, captured at its own rate as interleaved stereo f32 for the recording
//! (the speech capture in `rhema-audio` is mono 16 kHz, which is fine for Whisper and wrong for a service record).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, SizedSample};

/// A running capture; dropping it stops the stream.
pub struct Capture {
    pub rate: u32,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Drop for Capture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

/// Input devices by name (the id the settings store and the start request use).
#[must_use]
pub fn devices() -> Vec<String> {
    cpal::default_host().input_devices().map(|d| d.filter_map(|d| d.name().ok()).collect()).unwrap_or_default()
}

/// Start capturing `device` (exact name; empty = the system default input). `sink` gets each block as
/// interleaved stereo (mono is doubled, channels past two are left out); `lost` is told once if it fails.
pub fn start(
    device: &str,
    sink: impl FnMut(&[f32]) + Send + 'static,
    lost: impl Fn(String) + Send + 'static,
) -> Result<Capture, String> {
    let (ready_tx, ready_rx) = crossbeam_channel::bounded::<Result<u32, String>>(1);
    let stop = Arc::new(AtomicBool::new(false));
    let stop_t = stop.clone();
    let device = device.to_owned();
    // cpal's Stream is not Send: build it, run it and drop it on its own thread.
    let thread = std::thread::Builder::new()
        .name("recorder-audio".into())
        .spawn(move || {
            let built = (|| {
                let host = cpal::default_host();
                let dev = if device.is_empty() {
                    host.default_input_device().ok_or("no default input device")?
                } else {
                    host.input_devices()
                        .map_err(|e| e.to_string())?
                        .find(|d| d.name().is_ok_and(|n| n == device))
                        .ok_or_else(|| format!("audio input \"{device}\" is not connected"))?
                };
                let config = dev.default_input_config().map_err(|e| e.to_string())?;
                let rate = config.sample_rate().0;
                let channels = config.channels() as usize;
                let stream = match config.sample_format() {
                    SampleFormat::F32 => build::<f32>(&dev, &config.into(), channels, sink, lost),
                    SampleFormat::I16 => build::<i16>(&dev, &config.into(), channels, sink, lost),
                    SampleFormat::I32 => build::<i32>(&dev, &config.into(), channels, sink, lost),
                    SampleFormat::U16 => build::<u16>(&dev, &config.into(), channels, sink, lost),
                    other => return Err(format!("unsupported sample format {other:?}")),
                }?;
                stream.play().map_err(|e| e.to_string())?;
                Ok::<_, String>((stream, rate))
            })();
            match built {
                Ok((stream, rate)) => {
                    let _ = ready_tx.send(Ok(rate));
                    while !stop_t.load(Ordering::Relaxed) {
                        std::thread::sleep(Duration::from_millis(50));
                    }
                    drop(stream);
                }
                Err(e) => {
                    let _ = ready_tx.send(Err(e));
                }
            }
        })
        .map_err(|e| e.to_string())?;
    let rate = ready_rx.recv_timeout(Duration::from_secs(5)).map_err(|_| "the audio input did not start".to_string())??;
    Ok(Capture { rate, stop, thread: Some(thread) })
}

fn build<T: SizedSample + cpal::Sample>(
    dev: &cpal::Device,
    config: &cpal::StreamConfig,
    channels: usize,
    mut sink: impl FnMut(&[f32]) + Send + 'static,
    lost: impl Fn(String) + Send + 'static,
) -> Result<cpal::Stream, String>
where
    f32: cpal::FromSample<T>,
{
    let mut stereo: Vec<f32> = Vec::new();
    dev.build_input_stream(
        config,
        move |data: &[T], _| {
            stereo.clear();
            to_stereo(data, channels, &mut stereo);
            sink(&stereo);
        },
        move |e| lost(e.to_string()),
        None,
    )
    .map_err(|e| e.to_string())
}

/// Interleaved `channels`-channel samples → interleaved stereo f32.
fn to_stereo<T: cpal::Sample>(data: &[T], channels: usize, out: &mut Vec<f32>)
where
    f32: cpal::FromSample<T>,
{
    let channels = channels.max(1);
    out.reserve(data.len() / channels * 2);
    for frame in data.chunks_exact(channels) {
        let l: f32 = frame[0].to_sample();
        let r: f32 = if channels > 1 { frame[1].to_sample() } else { l };
        out.push(l);
        out.push(r);
    }
}

#[cfg(test)]
mod tests {
    use super::to_stereo;

    #[test]
    fn mono_is_doubled_and_extra_channels_are_left_out() {
        let mut out = Vec::new();
        to_stereo(&[0.5f32, -0.5], 1, &mut out);
        assert_eq!(out, vec![0.5, 0.5, -0.5, -0.5]);
        out.clear();
        to_stereo(&[0.1f32, 0.2, 0.9, 0.3, 0.4, 0.9], 3, &mut out);
        assert_eq!(out, vec![0.1, 0.2, 0.3, 0.4]);
        out.clear();
        to_stereo(&[i16::MAX, 0], 2, &mut out);
        assert!((out[0] - 1.0).abs() < 1e-3 && out[1] == 0.0);
    }
}
