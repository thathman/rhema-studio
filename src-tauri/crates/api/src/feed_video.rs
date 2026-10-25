//! What a browser feed's pages say about the cameras they play (#213 signal truth): frames decoded
//! and dropped, the frame rate they really show and how long ago the last new frame came. A page
//! (a Google TV, OBS Browser Source) sends this with its acknowledgement every few seconds; the host
//! shows it per screen in Show health. Measured on the screen, never guessed from a connection.

use std::collections::HashMap;
use std::net::IpAddr;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

/// A page's report older than this is not shown (the page went away or stopped reporting).
const FRESH: Duration = Duration::from_secs(10);
/// Pages remembered per feed at most; the oldest report goes first.
const MAX_PAGES: usize = 32;
/// Cameras per report at most (a scene has a few).
const MAX_CAMERAS: usize = 16;

/// One camera as one page plays it.
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct CameraPlayback {
    /// The camera's router name ("pulpit"); empty for an address typed by hand.
    pub camera: String,
    /// The page has a picture from it now.
    pub playing: bool,
    /// Frames a second it shows, measured on the page.
    pub fps: Option<f64>,
    /// Frames decoded and dropped since it started playing.
    pub decoded: Option<u64>,
    pub dropped: Option<u64>,
    /// Of the frames since its last report, the share dropped (0–100).
    pub dropped_pct: Option<f64>,
    /// Since its last new frame (ms).
    pub frame_age_ms: Option<u64>,
    /// The picture's size as it arrives.
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// The operator froze it (the page holds the last frame on purpose).
    pub held: bool,
    /// WebRTC's own counters on the page: jitter (ms), packets lost (%), round trip to the router (ms).
    pub jitter_ms: Option<f64>,
    pub loss_pct: Option<f64>,
    pub rtt_ms: Option<f64>,
    /// Frames a second arriving from the network, and decoded, on the page.
    pub recv_fps: Option<f64>,
    pub decode_fps: Option<f64>,
    /// From asking the router to the page's first frame (ms).
    pub first_frame_ms: Option<f64>,
}

impl CameraPlayback {
    /// Only sensible values: a camera name or nothing, rates and shares within range.
    fn clean(mut self) -> Self {
        if !crate::valid_camera_name(&self.camera) {
            self.camera.clear();
        }
        let within = |v: Option<f64>, max: f64| v.filter(|x| x.is_finite() && *x >= 0.0).map(|x| x.min(max));
        self.fps = within(self.fps, 240.0);
        self.dropped_pct = within(self.dropped_pct, 100.0);
        self.jitter_ms = within(self.jitter_ms, 60_000.0);
        self.loss_pct = within(self.loss_pct, 100.0);
        self.rtt_ms = within(self.rtt_ms, 60_000.0);
        self.recv_fps = within(self.recv_fps, 240.0);
        self.decode_fps = within(self.decode_fps, 240.0);
        self.first_frame_ms = within(self.first_frame_ms, 600_000.0);
        self.width = self.width.filter(|w| (1..=16384).contains(w));
        self.height = self.height.filter(|h| (1..=16384).contains(h));
        self
    }
}

/// One page's last report, for the operator.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageVideo {
    /// The page's address on the church network (a TV's, an OBS computer's).
    pub from: String,
    /// Milliseconds since it reported.
    pub ago_ms: u64,
    pub cameras: Vec<CameraPlayback>,
}

/// The reports of one feed's pages, by address.
#[derive(Debug, Default)]
pub struct FeedVideo {
    pages: HashMap<IpAddr, (Instant, Vec<CameraPlayback>)>,
}

impl FeedVideo {
    /// A page at `from` reported what it plays.
    pub fn report(&mut self, from: IpAddr, cameras: Vec<CameraPlayback>, now: Instant) {
        self.pages.retain(|_, (at, _)| now.saturating_duration_since(*at) < FRESH);
        if self.pages.len() >= MAX_PAGES && !self.pages.contains_key(&from) {
            if let Some(oldest) = self.pages.iter().min_by_key(|(_, (at, _))| *at).map(|(ip, _)| *ip) {
                self.pages.remove(&oldest);
            }
        }
        self.pages.insert(from, (now, cameras.into_iter().take(MAX_CAMERAS).map(CameraPlayback::clean).collect()));
    }

    /// The pages that reported lately, by address.
    #[must_use]
    pub fn pages(&self, now: Instant) -> Vec<PageVideo> {
        let mut v: Vec<PageVideo> = self
            .pages
            .iter()
            .filter(|(_, (at, _))| now.saturating_duration_since(*at) < FRESH)
            .map(|(ip, (at, cams))| PageVideo { from: ip.to_string(), ago_ms: u64::try_from(now.saturating_duration_since(*at).as_millis()).unwrap_or(u64::MAX), cameras: cams.clone() })
            .collect();
        v.sort_by(|a, b| a.from.cmp(&b.from));
        v
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cam(name: &str, fps: f64) -> CameraPlayback {
        CameraPlayback { camera: name.into(), playing: true, fps: Some(fps), decoded: Some(900), dropped: Some(2), dropped_pct: Some(0.2), frame_age_ms: Some(30), width: Some(1920), height: Some(1080), held: false, ..CameraPlayback::default() }
    }

    #[test]
    fn each_page_keeps_its_latest_report_until_it_goes_quiet() {
        let mut v = FeedVideo::default();
        let t0 = Instant::now();
        let tv: IpAddr = "192.168.1.40".parse().unwrap();
        let obs: IpAddr = "192.168.1.31".parse().unwrap();
        v.report(tv, vec![cam("pulpit", 29.8)], t0);
        v.report(obs, vec![cam("choir", 30.0)], t0);
        v.report(tv, vec![cam("pulpit", 24.0)], t0 + Duration::from_secs(2));
        let p = v.pages(t0 + Duration::from_secs(3));
        assert_eq!(p.iter().map(|x| x.from.as_str()).collect::<Vec<_>>(), vec!["192.168.1.31", "192.168.1.40"]);
        assert_eq!(p[1].cameras[0].fps, Some(24.0));
        assert_eq!(p[1].ago_ms, 1000);
        // The OBS page stopped reporting: gone after 10 s; the TV's stays.
        let p = v.pages(t0 + Duration::from_secs(11));
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].from, "192.168.1.40");
    }

    #[test]
    fn a_report_is_cleaned_before_it_is_kept() {
        let mut v = FeedVideo::default();
        let t0 = Instant::now();
        let odd = CameraPlayback { camera: "Bad Name\n".into(), fps: Some(f64::NAN), dropped_pct: Some(250.0), width: Some(0), jitter_ms: Some(-3.0), loss_pct: Some(400.0), rtt_ms: Some(f64::INFINITY), decode_fps: Some(59.9), ..cam("x", 1.0) };
        v.report("10.0.0.2".parse().unwrap(), (0..40).map(|_| odd.clone()).collect(), t0);
        let p = v.pages(t0);
        assert_eq!(p[0].cameras.len(), MAX_CAMERAS);
        let c = &p[0].cameras[0];
        assert_eq!((c.camera.as_str(), c.fps, c.dropped_pct, c.width), ("", None, Some(100.0), None));
        assert_eq!((c.jitter_ms, c.loss_pct, c.rtt_ms, c.decode_fps), (None, Some(100.0), None, Some(59.9)));
        // A report without the newer fields reads as nothing known.
        let bare: CameraPlayback = serde_json::from_str(r#"{"camera":"pulpit"}"#).unwrap();
        assert_eq!(bare, CameraPlayback { camera: "pulpit".into(), ..CameraPlayback::default() });
    }

    #[test]
    fn many_pages_keep_the_newest() {
        let mut v = FeedVideo::default();
        let t0 = Instant::now();
        for i in 0..40u8 {
            v.report(IpAddr::from([10, 0, 0, i]), vec![], t0 + Duration::from_millis(u64::from(i)));
        }
        let p = v.pages(t0 + Duration::from_millis(50));
        assert_eq!(p.len(), MAX_PAGES);
        assert!(!p.iter().any(|x| x.from == "10.0.0.0"), "the oldest went first");
    }
}
