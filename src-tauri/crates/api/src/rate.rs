//! Per-sender rate limiting for remote commands (PRD NFR-06): a token bucket
//! per source address. A Stream Deck or phone pressing buttons never gets
//! near the limit; a stuck controller or a flood on the LAN is cut off
//! instead of hammering the live output.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::Instant;

/// Sustained commands per second per sender.
pub const RATE_PER_SEC: f64 = 10.0;
/// Short bursts allowed (a macro, a quick double-press).
pub const BURST: f64 = 20.0;
/// Senders remembered at most; the least recently seen are dropped first.
const MAX_SENDERS: usize = 256;

struct Bucket {
    tokens: f64,
    last: Instant,
}

pub struct RateLimiter {
    buckets: Mutex<HashMap<IpAddr, Bucket>>,
    rate: f64,
    burst: f64,
}

impl Default for RateLimiter {
    fn default() -> Self {
        Self::new(RATE_PER_SEC, BURST)
    }
}

impl RateLimiter {
    #[must_use]
    pub fn new(rate: f64, burst: f64) -> Self {
        Self { buckets: Mutex::new(HashMap::new()), rate, burst }
    }

    /// True when `ip` may send one more command at `now`.
    pub fn allow_at(&self, ip: IpAddr, now: Instant) -> bool {
        let mut buckets = self.buckets.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if buckets.len() >= MAX_SENDERS && !buckets.contains_key(&ip) {
            if let Some(oldest) = buckets.iter().min_by_key(|(_, b)| b.last).map(|(k, _)| *k) {
                buckets.remove(&oldest);
            }
        }
        let b = buckets.entry(ip).or_insert(Bucket { tokens: self.burst, last: now });
        let elapsed = now.saturating_duration_since(b.last).as_secs_f64();
        b.tokens = (b.tokens + elapsed * self.rate).min(self.burst);
        b.last = now;
        if b.tokens >= 1.0 {
            b.tokens -= 1.0;
            true
        } else {
            false
        }
    }

    pub fn allow(&self, ip: IpAddr) -> bool {
        self.allow_at(ip, Instant::now())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn bursts_pass_floods_are_cut_and_tokens_refill() {
        let r = RateLimiter::new(10.0, 20.0);
        let a: IpAddr = "192.168.1.20".parse().unwrap();
        let b: IpAddr = "192.168.1.21".parse().unwrap();
        let t0 = Instant::now();
        assert!((0..20).all(|_| r.allow_at(a, t0)), "a burst of 20 passes");
        assert!(!r.allow_at(a, t0), "the 21st at once is refused");
        assert!(r.allow_at(b, t0), "another sender has its own bucket");
        assert!(r.allow_at(a, t0 + Duration::from_millis(100)), "one token back after 100 ms");
        assert!(!r.allow_at(a, t0 + Duration::from_millis(100)));
        assert!((0..20).all(|_| r.allow_at(a, t0 + Duration::from_secs(10))), "full again after a pause");
    }

    #[test]
    fn remembers_a_bounded_number_of_senders() {
        let r = RateLimiter::new(10.0, 1.0);
        let t0 = Instant::now();
        for i in 0..300u16 {
            let [hi, lo] = i.to_be_bytes();
            let ip = IpAddr::from([10, 0, hi, lo]);
            r.allow_at(ip, t0 + Duration::from_millis(u64::from(i)));
        }
        assert!(r.buckets.lock().unwrap().len() <= MAX_SENDERS);
    }
}
