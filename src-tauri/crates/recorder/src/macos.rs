//! macOS backend: `AVAssetWriter` writing fragmented MPEG-4 (H.264 through VideoToolbox, AAC through
//! AudioToolbox). System codecs only: nothing to license or ship. A movie fragment is flushed every
//! two seconds, so a file cut off by a crash or power loss stays playable up to its last fragment.
//!
//! Every object here lives on the one writer thread that created it (`AVAssetWriter` is not `Send`).

use std::ffi::c_void;
use std::path::Path;
use std::ptr::{self, NonNull};
use std::time::Duration;

use block2::RcBlock;
use objc2::rc::{autoreleasepool, Retained};
use objc2::runtime::AnyObject;
use objc2::Message;
use objc2_av_foundation::{
    AVAssetWriter, AVAssetWriterInput, AVAssetWriterInputPixelBufferAdaptor, AVAssetWriterStatus, AVFileTypeMPEG4,
    AVMediaTypeAudio, AVMediaTypeVideo, AVVideoAverageBitRateKey, AVVideoCodecKey, AVVideoCodecTypeH264,
    AVVideoCompressionPropertiesKey, AVVideoExpectedSourceFrameRateKey, AVVideoHeightKey, AVVideoMaxKeyFrameIntervalKey,
    AVVideoWidthKey,
};
use objc2_avf_audio::{AVEncoderBitRateKey, AVFormatIDKey, AVNumberOfChannelsKey, AVSampleRateKey};
use objc2_core_audio_types::{
    kAudioFormatFlagIsFloat, kAudioFormatFlagIsPacked, kAudioFormatLinearPCM, kAudioFormatMPEG4AAC,
    AudioStreamBasicDescription,
};
use objc2_core_foundation::CFRetained;
use objc2_core_media::{
    kCMBlockBufferAssureMemoryNowFlag, CMAudioFormatDescriptionCreate, CMAudioSampleBufferCreateReadyWithPacketDescriptions,
    CMBlockBuffer, CMFormatDescription, CMSampleBuffer, CMTime,
};
use objc2_core_video::{
    kCVPixelFormatType_32BGRA, CVPixelBuffer, CVPixelBufferCreate, CVPixelBufferGetBaseAddress,
    CVPixelBufferGetBytesPerRow, CVPixelBufferLockBaseAddress, CVPixelBufferLockFlags, CVPixelBufferUnlockBaseAddress,
};
use objc2_foundation::{NSDictionary, NSNumber, NSString, NSURL};

use crate::rgba_into_bgra;

/// Channels the file's audio track carries.
pub const AUDIO_CHANNELS: u32 = 2;

pub struct Writer {
    writer: Retained<AVAssetWriter>,
    video: Retained<AVAssetWriterInput>,
    adaptor: Retained<AVAssetWriterInputPixelBufferAdaptor>,
    audio: Option<(Retained<AVAssetWriterInput>, CFRetained<CMFormatDescription>, u32)>,
    width: u32,
    height: u32,
    /// The latest picture, appended again on every tick until a new one arrives.
    latest: Option<CFRetained<CVPixelBuffer>>,
}

fn key(k: Option<&'static NSString>) -> &'static NSString {
    k.expect("AVFoundation constant missing")
}

fn any<T: Message>(o: &T) -> &AnyObject {
    // Every Objective-C object is an AnyObject.
    unsafe { &*ptr::from_ref(o).cast::<AnyObject>() }
}

fn dict(pairs: &[(&NSString, &AnyObject)]) -> Retained<NSDictionary<NSString, AnyObject>> {
    let keys: Vec<&NSString> = pairs.iter().map(|p| p.0).collect();
    let values: Vec<&AnyObject> = pairs.iter().map(|p| p.1).collect();
    NSDictionary::from_slices(&keys, &values)
}

fn writer_error(writer: &AVAssetWriter) -> String {
    match unsafe { writer.error() } {
        None => format!("writer status {:?}", unsafe { writer.status() }),
        // The description alone is "The operation could not be completed": the code and the underlying OSStatus say why.
        Some(e) => {
            let under = e.userInfo().objectForKey(objc2_foundation::ns_string!("NSUnderlyingError"));
            let under = under.and_then(|u| u.downcast::<objc2_foundation::NSError>().ok()).map(|u| format!("; underlying {} {}", u.domain(), u.code()));
            format!("{} ({} {}{})", e.localizedDescription(), e.domain(), e.code(), under.unwrap_or_default())
        }
    }
}

impl Writer {
    /// Create the file and start writing. `audio_rate` is the mixer input's sample rate (`None`: no audio track).
    pub fn start(path: &Path, width: u32, height: u32, fps: u32, bitrate: u32, audio_rate: Option<u32>) -> Result<Self, String> {
        autoreleasepool(|_| unsafe {
            let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
            let writer = AVAssetWriter::assetWriterWithURL_fileType_error(&url, key(AVFileTypeMPEG4))
                .map_err(|e| e.localizedDescription().to_string())?;
            // Fragmented MPEG-4 needs pictures at a steady rate (a 2 s gap fails the close with -16341):
            // the session sends one every frame tick, repeating the latest (see `tick`).
            writer.setMovieFragmentInterval(CMTime::new(2, 1));

            let compression = dict(&[
                (key(AVVideoAverageBitRateKey), any(&*NSNumber::new_u32(bitrate))),
                (key(AVVideoMaxKeyFrameIntervalKey), any(&*NSNumber::new_u32(fps * 2))),
                (key(AVVideoExpectedSourceFrameRateKey), any(&*NSNumber::new_u32(fps))),
            ]);
            let settings = dict(&[
                (key(AVVideoCodecKey), any(key(AVVideoCodecTypeH264))),
                (key(AVVideoWidthKey), any(&*NSNumber::new_u32(width))),
                (key(AVVideoHeightKey), any(&*NSNumber::new_u32(height))),
                (key(AVVideoCompressionPropertiesKey), any(&*compression)),
            ]);
            let video = AVAssetWriterInput::assetWriterInputWithMediaType_outputSettings(key(AVMediaTypeVideo), Some(&settings));
            video.setExpectsMediaDataInRealTime(true);
            let adaptor =
                AVAssetWriterInputPixelBufferAdaptor::assetWriterInputPixelBufferAdaptorWithAssetWriterInput_sourcePixelBufferAttributes(&video, None);
            if !writer.canAddInput(&video) {
                return Err("the H.264 encoder refused this picture size".into());
            }
            writer.addInput(&video);

            let audio = match audio_rate {
                None => None,
                Some(rate) => {
                    let settings = dict(&[
                        (key(AVFormatIDKey), any(&*NSNumber::new_u32(kAudioFormatMPEG4AAC))),
                        (key(AVSampleRateKey), any(&*NSNumber::new_f64(f64::from(rate)))),
                        (key(AVNumberOfChannelsKey), any(&*NSNumber::new_u32(AUDIO_CHANNELS))),
                        (key(AVEncoderBitRateKey), any(&*NSNumber::new_u32(192_000))),
                    ]);
                    let input = AVAssetWriterInput::assetWriterInputWithMediaType_outputSettings(key(AVMediaTypeAudio), Some(&settings));
                    input.setExpectsMediaDataInRealTime(true);
                    if !writer.canAddInput(&input) {
                        return Err(format!("the AAC encoder refused {rate} Hz stereo"));
                    }
                    writer.addInput(&input);
                    Some((input, pcm_format(rate)?, rate))
                }
            };

            if !writer.startWriting() {
                return Err(writer_error(&writer));
            }
            writer.startSessionAtSourceTime(CMTime::new(0, 1));
            Ok(Self { writer, video, adaptor, audio, width, height, latest: None })
        })
    }

    /// The output's newest RGBA picture: it is what the next ticks write.
    pub fn set_frame(&mut self, rgba: &[u8]) -> Result<(), String> {
        autoreleasepool(|_| unsafe {
            let mut out: *mut CVPixelBuffer = ptr::null_mut();
            // ponytail: a buffer per new picture (repeats reuse it); use the adaptor's IOSurface pool if profiling says so.
            let rv = CVPixelBufferCreate(None, self.width as usize, self.height as usize, kCVPixelFormatType_32BGRA, None, NonNull::from(&mut out));
            let pb = NonNull::new(out).filter(|_| rv == 0).ok_or_else(|| format!("CVPixelBufferCreate failed ({rv})"))?;
            let pb: CFRetained<CVPixelBuffer> = CFRetained::from_raw(pb);
            CVPixelBufferLockBaseAddress(&pb, CVPixelBufferLockFlags(0));
            let base = CVPixelBufferGetBaseAddress(&pb).cast::<u8>();
            let stride = CVPixelBufferGetBytesPerRow(&pb);
            let dst = std::slice::from_raw_parts_mut(base, stride * self.height as usize);
            rgba_into_bgra(rgba, dst, self.width as usize, self.height as usize, stride);
            CVPixelBufferUnlockBaseAddress(&pb, CVPixelBufferLockFlags(0));
            self.latest = Some(pb);
            Ok(())
        })
    }

    /// Write the latest picture at `pts_us` (µs since the session started): the file gets a constant
    /// frame rate whatever the screen sends. `Ok(false)`: nothing yet, or the encoder is busy (a
    /// skipped tick); `Err`: the writer failed.
    pub fn tick(&self, pts_us: i64) -> Result<bool, String> {
        let Some(pb) = &self.latest else { return Ok(false) };
        autoreleasepool(|_| unsafe {
            if !self.video.isReadyForMoreMediaData() {
                return Ok(false);
            }
            if self.adaptor.appendPixelBuffer_withPresentationTime(pb, CMTime::new(pts_us, 1_000_000)) {
                Ok(true)
            } else {
                Err(writer_error(&self.writer))
            }
        })
    }

    /// Append interleaved stereo f32 samples starting at frame `pts_frames` of the audio clock.
    pub fn append_audio(&self, samples: &[f32], pts_frames: i64) -> Result<bool, String> {
        let Some((input, format, rate)) = &self.audio else { return Ok(true) };
        let frames = samples.len() / AUDIO_CHANNELS as usize;
        if frames == 0 {
            return Ok(true);
        }
        autoreleasepool(|_| unsafe {
            if !input.isReadyForMoreMediaData() {
                return Ok(false);
            }
            let len = std::mem::size_of_val(samples);
            let mut bb: *mut CMBlockBuffer = ptr::null_mut();
            let rv = CMBlockBuffer::create_with_memory_block(None, ptr::null_mut(), len, None, ptr::null(), 0, len, kCMBlockBufferAssureMemoryNowFlag, NonNull::from(&mut bb));
            let bb = NonNull::new(bb).filter(|_| rv == 0).ok_or_else(|| format!("CMBlockBuffer failed ({rv})"))?;
            let bb: CFRetained<CMBlockBuffer> = CFRetained::from_raw(bb);
            let rv = CMBlockBuffer::replace_data_bytes(NonNull::new_unchecked(samples.as_ptr().cast_mut().cast::<c_void>()), &bb, 0, len);
            if rv != 0 {
                return Err(format!("CMBlockBufferReplaceDataBytes failed ({rv})"));
            }
            let mut sb: *mut CMSampleBuffer = ptr::null_mut();
            let rv = CMAudioSampleBufferCreateReadyWithPacketDescriptions(
                None,
                &bb,
                format,
                frames as isize,
                CMTime::new(pts_frames, *rate as i32),
                ptr::null(),
                NonNull::from(&mut sb),
            );
            let sb = NonNull::new(sb).filter(|_| rv == 0).ok_or_else(|| format!("audio sample buffer failed ({rv})"))?;
            let sb: CFRetained<CMSampleBuffer> = CFRetained::from_raw(sb);
            if input.appendSampleBuffer(&sb) {
                Ok(true)
            } else {
                Err(writer_error(&self.writer))
            }
        })
    }

    /// Close the file properly (the index at the end); blocks until AVFoundation is done.
    pub fn finish(self) -> Result<(), String> {
        let (tx, rx) = crossbeam_channel::bounded::<()>(1);
        autoreleasepool(|_| unsafe {
            self.video.markAsFinished();
            if let Some((input, ..)) = &self.audio {
                input.markAsFinished();
            }
            let done = RcBlock::new(move || {
                let _ = tx.send(());
            });
            self.writer.finishWritingWithCompletionHandler(&done);
        });
        rx.recv_timeout(Duration::from_secs(60)).map_err(|_| "finishing the file timed out".to_string())?;
        if unsafe { self.writer.status() } == AVAssetWriterStatus::Completed {
            Ok(())
        } else {
            Err(writer_error(&self.writer))
        }
    }
}

/// Interleaved stereo 32-bit float PCM at `rate`: what the capture hands the AAC encoder.
fn pcm_format(rate: u32) -> Result<CFRetained<CMFormatDescription>, String> {
    let asbd = AudioStreamBasicDescription {
        mSampleRate: f64::from(rate),
        mFormatID: kAudioFormatLinearPCM,
        mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked,
        mBytesPerPacket: 4 * AUDIO_CHANNELS,
        mFramesPerPacket: 1,
        mBytesPerFrame: 4 * AUDIO_CHANNELS,
        mChannelsPerFrame: AUDIO_CHANNELS,
        mBitsPerChannel: 32,
        mReserved: 0,
    };
    let mut out: *const CMFormatDescription = ptr::null();
    let rv = unsafe { CMAudioFormatDescriptionCreate(None, NonNull::from(&asbd), 0, ptr::null(), 0, ptr::null(), None, NonNull::from(&mut out)) };
    let out = NonNull::new(out.cast_mut()).filter(|_| rv == 0).ok_or_else(|| format!("audio format failed ({rv})"))?;
    Ok(unsafe { CFRetained::from_raw(out) })
}

/// What a finished file holds, read back through AVFoundation (tests and the archive's "playable" check).
#[derive(Debug, Clone, PartialEq)]
pub struct Probe {
    pub duration_s: f64,
    pub video_tracks: usize,
    pub audio_tracks: usize,
    pub width: f64,
    pub height: f64,
}

#[allow(deprecated)]
pub fn probe(path: &Path) -> Probe {
    autoreleasepool(|_| unsafe {
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
        let asset = objc2_av_foundation::AVURLAsset::URLAssetWithURL_options(&url, None);
        let d = asset.duration();
        let video = asset.tracksWithMediaType(key(AVMediaTypeVideo));
        let audio = asset.tracksWithMediaType(key(AVMediaTypeAudio));
        let size = video.firstObject().map(|t| t.naturalSize());
        Probe {
            duration_s: if d.timescale > 0 { d.value as f64 / f64::from(d.timescale) } else { 0.0 },
            video_tracks: video.count(),
            audio_tracks: audio.count(),
            width: size.map_or(0.0, |s| s.width),
            height: size.map_or(0.0, |s| s.height),
        }
    })
}
