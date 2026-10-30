//! Windows backend: Media Foundation's Sink Writer writing fragmented MPEG-4 (H.264 and AAC through
//! the encoders Windows ships, hardware where there is one). System codecs only: nothing to license
//! or ship. As on macOS, a file cut off by a crash or power loss stays playable up to its last fragment.
//!
//! Every object here lives on the one writer thread that created it.

use std::path::Path;

use windows::core::{Interface, GUID, HSTRING};
use windows::Win32::Media::MediaFoundation::{
    CODECAPI_AVEncMPVGOPSize, ICodecAPI, IMFAttributes, IMFMediaBuffer, IMFMediaType, IMFSample, IMFSinkWriter, MFAudioFormat_AAC, MFAudioFormat_PCM,
    MFCreateAttributes, MFCreateMediaType, MFCreateMemoryBuffer, MFCreateSample, MFCreateSinkWriterFromURL, MFCreateSourceReaderFromURL, MFMediaType_Audio,
    MFMediaType_Video, MFShutdown, MFStartup, MFTranscodeContainerType_FMPEG4, MFVideoFormat_H264, MFVideoFormat_NV12, MFVideoInterlace_Progressive,
    MFVideoTransferMatrix_BT709, MFSTARTUP_FULL, MF_MT_AUDIO_AVG_BYTES_PER_SECOND, MF_MT_AUDIO_BITS_PER_SAMPLE, MF_MT_AUDIO_BLOCK_ALIGNMENT,
    MF_MT_AUDIO_NUM_CHANNELS, MF_MT_AUDIO_SAMPLES_PER_SECOND, MF_MT_AVG_BITRATE, MF_MT_DEFAULT_STRIDE, MF_MT_FRAME_RATE, MF_MT_FRAME_SIZE, MF_MT_INTERLACE_MODE,
    MF_MT_MAJOR_TYPE, MF_MT_PIXEL_ASPECT_RATIO, MF_MT_SUBTYPE, MF_MT_YUV_MATRIX, MF_PD_DURATION, MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS,
    MF_SOURCE_READER_FIRST_AUDIO_STREAM, MF_SOURCE_READERF_ENDOFSTREAM, MF_SOURCE_READER_FIRST_VIDEO_STREAM, MF_SOURCE_READER_MEDIASOURCE, MF_TRANSCODE_CONTAINERTYPE, MF_VERSION,
};
use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED};

use crate::rgba_to_nv12;

/// Channels the file's audio track carries.
pub const AUDIO_CHANNELS: u32 = 2;
/// Sample rates the Windows AAC encoder takes.
const AAC_RATES: [u32; 2] = [44_100, 48_000];
/// Media Foundation counts time in 100 ns units.
const TICKS_PER_SECOND: i64 = 10_000_000;

fn err(what: &str, e: &windows::core::Error) -> String {
    format!("{what}: {e}")
}

/// COM and Media Foundation for this thread, for as long as the value lives.
struct MediaFoundation;

impl MediaFoundation {
    fn start() -> Result<Self, String> {
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED).ok().map_err(|e| err("COM", &e))?;
            if let Err(e) = MFStartup(MF_VERSION, MFSTARTUP_FULL) {
                CoUninitialize();
                return Err(err("Media Foundation", &e));
            }
        }
        Ok(Self)
    }
}

impl Drop for MediaFoundation {
    fn drop(&mut self) {
        unsafe {
            let _ = MFShutdown();
            CoUninitialize();
        }
    }
}

pub struct Writer {
    sink: IMFSinkWriter,
    video: u32,
    audio: Option<(u32, u32)>,
    width: u32,
    height: u32,
    frame_ticks: i64,
    /// The latest picture, appended again on every tick until a new one arrives.
    latest: Option<IMFMediaBuffer>,
    // Last, so the writer's objects are released before Media Foundation shuts down.
    _mf: MediaFoundation,
}

/// Two 32-bit values in one attribute: width and height, or a ratio.
fn pair(high: u32, low: u32) -> u64 {
    (u64::from(high) << 32) | u64::from(low)
}

fn video_type(subtype: &GUID, width: u32, height: u32, fps: u32) -> windows::core::Result<IMFMediaType> {
    unsafe {
        let t = MFCreateMediaType()?;
        t.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
        t.SetGUID(&MF_MT_SUBTYPE, subtype)?;
        t.SetUINT64(&MF_MT_FRAME_SIZE, pair(width, height))?;
        t.SetUINT64(&MF_MT_FRAME_RATE, pair(fps, 1))?;
        t.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pair(1, 1))?;
        t.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
        t.SetUINT32(&MF_MT_YUV_MATRIX, MFVideoTransferMatrix_BT709.0 as u32)?;
        Ok(t)
    }
}

fn audio_type(subtype: &GUID, rate: u32) -> windows::core::Result<IMFMediaType> {
    unsafe {
        let t = MFCreateMediaType()?;
        t.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)?;
        t.SetGUID(&MF_MT_SUBTYPE, subtype)?;
        t.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, AUDIO_CHANNELS)?;
        t.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, rate)?;
        t.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16)?;
        Ok(t)
    }
}

fn sample(buffer: &IMFMediaBuffer, at: i64, duration: i64) -> windows::core::Result<IMFSample> {
    unsafe {
        let s = MFCreateSample()?;
        s.AddBuffer(buffer)?;
        s.SetSampleTime(at)?;
        s.SetSampleDuration(duration)?;
        Ok(s)
    }
}

/// A buffer of exactly `len` bytes, filled by `fill`.
fn buffer(len: u32, fill: impl FnOnce(&mut [u8])) -> windows::core::Result<IMFMediaBuffer> {
    unsafe {
        let b = MFCreateMemoryBuffer(len)?;
        let mut data = std::ptr::null_mut();
        b.Lock(&mut data, None, None)?;
        fill(std::slice::from_raw_parts_mut(data, len as usize));
        b.Unlock()?;
        b.SetCurrentLength(len)?;
        Ok(b)
    }
}

impl Writer {
    /// Create the file and start writing. `audio_rate` is the mixer input's sample rate (`None`: no audio track).
    pub fn start(path: &Path, width: u32, height: u32, fps: u32, bitrate: u32, audio_rate: Option<u32>) -> Result<Self, String> {
        if width % 2 != 0 || height % 2 != 0 {
            return Err(format!("H.264 needs an even picture size, not {width}x{height}"));
        }
        // ponytail: 44.1 and 48 kHz only (what the Windows AAC encoder takes); resample when a real desk runs at 96 kHz.
        if let Some(rate) = audio_rate.filter(|r| !AAC_RATES.contains(r)) {
            return Err(format!("the sound input runs at {rate} Hz; set it to 48000 Hz in Windows sound settings"));
        }
        let mf = MediaFoundation::start()?;
        unsafe {
            let attrs: IMFAttributes = {
                let mut a = None;
                MFCreateAttributes(&mut a, 2).map_err(|e| err("attributes", &e))?;
                a.ok_or("attributes: none returned")?
            };
            attrs.SetGUID(&MF_TRANSCODE_CONTAINERTYPE, &MFTranscodeContainerType_FMPEG4).map_err(|e| err("container", &e))?;
            attrs.SetUINT32(&MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, 1).map_err(|e| err("hardware encoding", &e))?;
            let sink = MFCreateSinkWriterFromURL(&HSTRING::from(path), None, &attrs).map_err(|e| err("creating the file", &e))?;

            let out = video_type(&MFVideoFormat_H264, width, height, fps).map_err(|e| err("video format", &e))?;
            out.SetUINT32(&MF_MT_AVG_BITRATE, bitrate).map_err(|e| err("video bitrate", &e))?;
            let video = sink.AddStream(&out).map_err(|e| err("video track", &e))?;
            let input = video_type(&MFVideoFormat_NV12, width, height, fps).map_err(|e| err("picture format", &e))?;
            input.SetUINT32(&MF_MT_DEFAULT_STRIDE, width).map_err(|e| err("picture stride", &e))?;
            sink.SetInputMediaType(video, &input, None).map_err(|e| err("H.264 encoder", &e))?;
            // A key frame every 2 s, as on macOS: fragments start on one, so this bounds what a crash loses.
            // An encoder that refuses still writes a valid file, with longer fragments.
            set_key_frame_interval(&sink, video, fps * 2);

            let audio = match audio_rate {
                None => None,
                Some(rate) => {
                    let out = audio_type(&MFAudioFormat_AAC, rate).map_err(|e| err("audio format", &e))?;
                    out.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, 24_000).map_err(|e| err("audio bitrate", &e))?;
                    let stream = sink.AddStream(&out).map_err(|e| err("audio track", &e))?;
                    let input = audio_type(&MFAudioFormat_PCM, rate).map_err(|e| err("sound format", &e))?;
                    input.SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, 2 * AUDIO_CHANNELS).map_err(|e| err("sound format", &e))?;
                    input.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, rate * 2 * AUDIO_CHANNELS).map_err(|e| err("sound format", &e))?;
                    sink.SetInputMediaType(stream, &input, None).map_err(|e| err("AAC encoder", &e))?;
                    Some((stream, rate))
                }
            };
            sink.BeginWriting().map_err(|e| err("starting the file", &e))?;
            Ok(Self { sink, video, audio, width, height, frame_ticks: TICKS_PER_SECOND / i64::from(fps.max(1)), latest: None, _mf: mf })
        }
    }

    /// Convert one RGBA frame to the picture later ticks repeat.
    pub fn set_frame(&mut self, rgba: &[u8]) -> Result<(), String> {
        let (w, h) = (self.width as usize, self.height as usize);
        if rgba.len() != w * h * 4 {
            return Err(format!("frame of {} bytes for {w}x{h}", rgba.len()));
        }
        let b = buffer((w * h * 3 / 2) as u32, |nv12| rgba_to_nv12(rgba, nv12, w, h)).map_err(|e| err("picture", &e))?;
        self.latest = Some(b);
        Ok(())
    }

    /// Append the latest picture at `pts_us` (see the macOS writer). `Ok(false)`: no picture yet. The
    /// Sink Writer never refuses a sample: when the encoder is behind this call waits instead.
    pub fn tick(&self, pts_us: i64) -> Result<bool, String> {
        let Some(b) = &self.latest else { return Ok(false) };
        let s = sample(b, pts_us * 10, self.frame_ticks).map_err(|e| err("picture", &e))?;
        unsafe { self.sink.WriteSample(self.video, &s) }.map_err(|e| err("writing a picture", &e))?;
        Ok(true)
    }

    /// Append interleaved stereo f32 samples starting at frame `pts_frames` of the audio clock.
    pub fn append_audio(&self, samples: &[f32], pts_frames: i64) -> Result<bool, String> {
        let Some((stream, rate)) = self.audio else { return Ok(true) };
        let frames = samples.len() / AUDIO_CHANNELS as usize;
        if frames == 0 {
            return Ok(true);
        }
        let rate = i64::from(rate);
        let b = buffer((samples.len() * 2) as u32, |pcm| {
            for (d, s) in pcm.chunks_exact_mut(2).zip(samples) {
                d.copy_from_slice(&pcm16(*s).to_le_bytes());
            }
        })
        .map_err(|e| err("sound", &e))?;
        let s = sample(&b, pts_frames * TICKS_PER_SECOND / rate, frames as i64 * TICKS_PER_SECOND / rate).map_err(|e| err("sound", &e))?;
        unsafe { self.sink.WriteSample(stream, &s) }.map_err(|e| err("writing sound", &e))?;
        Ok(true)
    }

    /// Close the file properly; blocks until Media Foundation is done.
    pub fn finish(self) -> Result<(), String> {
        unsafe { self.sink.Finalize() }.map_err(|e| err("closing the file", &e))
    }
}

fn set_key_frame_interval(sink: &IMFSinkWriter, stream: u32, frames: u32) {
    let set = || -> windows::core::Result<()> {
        unsafe {
            let mut api: *mut core::ffi::c_void = std::ptr::null_mut();
            sink.GetServiceForStream(stream, &GUID::zeroed(), &ICodecAPI::IID, &mut api)?;
            let api = ICodecAPI::from_raw(api);
            api.SetValue(&CODECAPI_AVEncMPVGOPSize, &VARIANT::from(frames))
        }
    };
    if let Err(e) = set() {
        log::warn!("recorder: encoder kept its own key frame interval: {e}");
    }
}

fn pcm16(s: f32) -> i16 {
    (s.clamp(-1.0, 1.0) * f32::from(i16::MAX)) as i16
}

/// Keeps Windows from sleeping the computer or blanking the display while this thread lives (the
/// writer thread, for the whole recording): a blanked display stops the output window painting.
pub struct Awake;

impl Awake {
    #[must_use]
    pub fn hold() -> Self {
        unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED) };
        Self
    }
}

impl Drop for Awake {
    fn drop(&mut self) {
        unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
    }
}

#[derive(Debug)]
pub struct Probe {
    pub duration_s: f64,
    pub video_tracks: usize,
    pub audio_tracks: usize,
    pub width: f64,
    pub height: f64,
}

/// What Windows itself reads back from a finished file.
pub fn probe(path: &Path) -> Probe {
    let mut p = Probe { duration_s: 0.0, video_tracks: 0, audio_tracks: 0, width: 0.0, height: 0.0 };
    let Ok(_mf) = MediaFoundation::start() else { return p };
    unsafe {
        let Ok(reader) = MFCreateSourceReaderFromURL(&HSTRING::from(path), None) else { return p };
        if let Ok(t) = reader.GetNativeMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32, 0) {
            p.video_tracks = 1;
            if let Ok(size) = t.GetUINT64(&MF_MT_FRAME_SIZE) {
                p.width = f64::from((size >> 32) as u32);
                p.height = f64::from(size as u32);
            }
        }
        if reader.GetNativeMediaType(MF_SOURCE_READER_FIRST_AUDIO_STREAM.0 as u32, 0).is_ok() {
            p.audio_tracks = 1;
        }
        let d: Option<PROPVARIANT> = reader.GetPresentationAttribute(MF_SOURCE_READER_MEDIASOURCE.0 as u32, &MF_PD_DURATION).ok();
        if let Some(ticks) = d.and_then(|d| u64::try_from(&d).ok()) {
            p.duration_s = ticks as f64 / TICKS_PER_SECOND as f64;
        }
        // A file cut off by a crash declares no duration: what plays is what can actually be read.
        if p.duration_s == 0.0 {
            let (mut flags, mut at, mut last, mut read) = (0u32, 0i64, 0i64, None);
            loop {
                match reader.ReadSample(MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32, 0, None, Some(&mut flags), Some(&mut at), Some(&mut read)) {
                    Ok(()) if flags & MF_SOURCE_READERF_ENDOFSTREAM.0 as u32 == 0 => last = last.max(at),
                    Ok(()) => break,
                    Err(e) => {
                        log::warn!("recorder probe: {e}");
                        eprintln!("recorder probe: reading stopped: {e}");
                        break;
                    }
                }
            }
            p.duration_s = last as f64 / TICKS_PER_SECOND as f64;
        }
    }
    p
}

#[cfg(test)]
mod tests {
    use super::pcm16;

    #[test]
    fn sound_is_clamped_not_wrapped() {
        assert_eq!((pcm16(0.0), pcm16(1.0), pcm16(4.0), pcm16(-4.0)), (0, i16::MAX, i16::MAX, -i16::MAX));
    }
}
