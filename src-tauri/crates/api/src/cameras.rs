//! Phone cameras (OP-009, #209): a phone opens Rhema's camera page (`/camera`, over https because
//! a browser gives a page the camera only on a secure page) and publishes to the camera router
//! (the MediaMTX bundled with Rhema) with WHIP. The page cannot post to the router itself (plain
//! http from an https page, and the router wants Rhema's publish password), so its WHIP requests
//! come here and are passed on to the router on this computer. Only the signalling passes
//! through Rhema; the video flows straight from the phone to the router.
//!
//! Each camera publishes as its own router user (`cam-<name>`, its link's secret as the password),
//! allowed to send to its own name only; a new link or removing the camera closes that door.

use std::collections::HashMap;
use std::sync::{Arc, PoisonError, RwLock};

use axum::body::Bytes;
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};

/// A WHIP offer or ICE patch is a few kilobytes; anything near this is not one.
const MAX_BODY: usize = 64 * 1024;

/// A camera's router user is this and its name (never `any`, which the router reads as "anyone").
pub const PUBLISH_PREFIX: &str = "cam-";

/// Where the router listens for WHIP.
#[derive(Clone, Debug)]
pub struct RouterTarget {
    /// e.g. `http://127.0.0.1:8889`
    pub base: String,
}

/// The cameras the operator added (name and the secret in its camera-page link) and the running
/// router, if any. The app keeps both in step; a removed camera's link stops working at once.
#[derive(Default)]
pub struct CameraHub {
    cameras: RwLock<HashMap<String, String>>,
    router: RwLock<Option<RouterTarget>>,
}

// Never print a camera's secret (HttpConfig is Debug).
impl std::fmt::Debug for CameraHub {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let n = self.cameras.read().unwrap_or_else(PoisonError::into_inner).len();
        let on = self.router.read().unwrap_or_else(PoisonError::into_inner).is_some();
        f.debug_struct("CameraHub").field("cameras", &n).field("router", &on).finish()
    }
}

pub type SharedCameras = Arc<CameraHub>;

#[must_use]
pub fn new_camera_hub() -> SharedCameras {
    Arc::new(CameraHub::default())
}

/// A camera's name as the router knows it (its path): lower-case letters, digits, `-` and `_`.
#[must_use]
pub fn valid_camera_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 40 && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_') && !name.starts_with(['-', '_'])
}

impl CameraHub {
    /// Replace the list of cameras (name, secret); bad names and short secrets are dropped.
    pub fn set(&self, list: &[(String, String)]) {
        let map = list.iter().filter(|(n, t)| valid_camera_name(n) && t.len() >= 16).cloned().collect();
        *self.cameras.write().unwrap_or_else(PoisonError::into_inner) = map;
    }

    /// The router started (Some) or stopped (None).
    pub fn set_router(&self, target: Option<RouterTarget>) {
        *self.router.write().unwrap_or_else(PoisonError::into_inner) = target;
    }

    /// The cameras now (name, secret), for the router's settings.
    #[must_use]
    pub fn list(&self) -> Vec<(String, String)> {
        let mut v: Vec<(String, String)> = self.cameras.read().unwrap_or_else(PoisonError::into_inner).iter().map(|(n, t)| (n.clone(), t.clone())).collect();
        v.sort();
        v
    }

    pub(crate) fn knows(&self, name: &str, token: &str) -> bool {
        self.cameras.read().unwrap_or_else(PoisonError::into_inner).get(name).is_some_and(|t| crate::command::same_key(token, t))
    }

    fn router(&self) -> Option<RouterTarget> {
        self.router.read().unwrap_or_else(PoisonError::into_inner).clone()
    }

    /// Pass one WHIP request (POST the offer; PATCH ICE; DELETE to hang up) to the router, signed
    /// in as that camera, and hand back its answer. The session address in `Location` is rewritten to
    /// this route so the page's next request comes here too.
    pub(crate) async fn forward(&self, method: Method, name: &str, session: Option<&str>, headers: &HeaderMap, body: Bytes) -> Response {
        let Some(token) = self.cameras.read().unwrap_or_else(PoisonError::into_inner).get(name).cloned() else {
            return StatusCode::FORBIDDEN.into_response();
        };
        let Some(router) = self.router() else {
            return (StatusCode::SERVICE_UNAVAILABLE, "The camera router is off. Turn it on in Rhema: Production, Cameras.").into_response();
        };
        if body.len() > MAX_BODY {
            return StatusCode::PAYLOAD_TOO_LARGE.into_response();
        }
        if session.is_some_and(|s| s.is_empty() || s.len() > 128 || !s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')) {
            return StatusCode::NOT_FOUND.into_response();
        }
        let url = match session {
            Some(s) => format!("{}/{name}/whip/{s}", router.base),
            None => format!("{}/{name}/whip", router.base),
        };
        let Ok(client) = reqwest::Client::builder().connect_timeout(std::time::Duration::from_secs(3)).timeout(std::time::Duration::from_secs(15)).build() else {
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        };
        let Ok(m) = reqwest::Method::from_bytes(method.as_str().as_bytes()) else {
            return StatusCode::METHOD_NOT_ALLOWED.into_response();
        };
        let mut req = client.request(m, url).basic_auth(format!("{PUBLISH_PREFIX}{name}"), Some(&token)).body(body.to_vec());
        for h in ["content-type", "if-match"] {
            if let Some(v) = headers.get(h).and_then(|v| v.to_str().ok()) {
                req = req.header(h, v);
            }
        }
        let resp = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                log::warn!("camera {name}: the router did not answer: {e}");
                return (StatusCode::BAD_GATEWAY, "The camera router did not answer. Is it running?").into_response();
            }
        };
        let status = resp.status().as_u16();
        // The router refused the camera's sign-in (it may still be taking in a new link): say so
        // plainly, and never ask the phone to sign in itself.
        if status == 401 || status == 403 {
            log::warn!("camera {name}: the router refused its sign-in");
            return (StatusCode::BAD_GATEWAY, "The camera router refused this camera. Try again in a moment; if it keeps happening, turn the router off and on in Rhema.").into_response();
        }
        let mut out = HeaderMap::new();
        for h in ["content-type", "etag", "accept-patch"] {
            if let Some(v) = resp.headers().get(h).and_then(|v| HeaderValue::from_bytes(v.as_bytes()).ok()) {
                out.insert(h, v);
            }
        }
        if let Some(loc) = resp.headers().get("location").and_then(|v| v.to_str().ok()).and_then(|l| rewrite_location(name, l)) {
            if let Ok(v) = HeaderValue::from_str(&loc) {
                out.insert("location", v);
            }
        }
        let code = StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY);
        let bytes = resp.bytes().await.unwrap_or_default();
        (code, out, bytes).into_response()
    }
}

/// The router's session address (`/pulpit/whip/<id>`, or a full URL ending so) as this route.
fn rewrite_location(name: &str, location: &str) -> Option<String> {
    let path = location.split_once("://").map_or(location, |(_, rest)| rest.find('/').map_or("", |i| &rest[i..]));
    let id = path.strip_prefix(&format!("/{name}/whip/"))?;
    let id = id.split(['?', '#']).next().unwrap_or("");
    (!id.is_empty()).then(|| format!("/api/v1/camera/{name}/whip/{id}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn camera_names_are_router_paths() {
        for ok in ["pulpit", "choir-2", "wide_left", "a", "1"] {
            assert!(valid_camera_name(ok), "{ok}");
        }
        for no in ["", "Pulpit", "pul pit", "../x", "-x", "a/b", "x?y", &"a".repeat(41)] {
            assert!(!valid_camera_name(no), "{no}");
        }
    }

    #[test]
    fn the_session_address_points_back_through_rhema() {
        assert_eq!(rewrite_location("pulpit", "/pulpit/whip/0f3c-aa").as_deref(), Some("/api/v1/camera/pulpit/whip/0f3c-aa"));
        assert_eq!(rewrite_location("pulpit", "http://127.0.0.1:8889/pulpit/whip/abc?x=1").as_deref(), Some("/api/v1/camera/pulpit/whip/abc"));
        assert_eq!(rewrite_location("pulpit", "/choir/whip/abc"), None, "another camera's session");
        assert_eq!(rewrite_location("pulpit", "/pulpit/whip/"), None);
    }

    #[test]
    fn short_secrets_and_bad_names_never_open_a_camera() {
        let hub = CameraHub::default();
        hub.set(&[("pulpit".into(), "0123456789abcdef".into()), ("choir".into(), "short".into()), ("Bad Name".into(), "0123456789abcdef".into())]);
        assert!(hub.knows("pulpit", "0123456789abcdef"));
        assert!(!hub.knows("pulpit", "0123456789abcdeX"));
        assert!(!hub.knows("choir", "short"));
        assert!(!hub.knows("Bad Name", "0123456789abcdef"));
        let shown = format!("{hub:?}");
        assert!(!shown.contains("0123456789abcdef"), "{shown}");
    }
}
