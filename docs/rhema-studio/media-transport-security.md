# Media transport security

What crosses the church network, whether it is encrypted, and what limits each fix. Checked against the code and MediaMTX 1.21.2 on 1 November 2026. No real TV, phone or OBS took part: physical acceptance is pending (`docs/HARDWARE-ACCEPTANCE-CHECKLIST.md`, section 7b).

## Encrypted today

| Path | How |
| --- | --- |
| Google TV feed and its cameras | https with one exact certificate pinned; WebRTC after a pinned relay |
| Rhema Studio Cam to router | RTSPS with one exact certificate pinned, no fallback |
| Phone camera page | https relay then WebRTC. Safe from tampering only with the CA installed: a clicked-through warning proves nothing |
| OBS companion to router | SRT with a passphrase |
| Companion app to host | https with the CA pinned; no plain path |
| Joined desk that paired over https | https with the CA pinned |

## Still readable or changeable on the network

WebRTC media is always encrypted, but its only identity is the certificate fingerprint in the signalling. Where signalling is plain http, someone on the path can swap that fingerprint and sit in the middle of the media.

| Exposure, worst first | What it exposes | What limits the fix | Now |
| --- | --- | --- | --- |
| http port 8080, the default for feed links and the API | Keys, service content, swappable signalling and page scripts | OBS Browser Source and browsers must first trust the local CA; older desks use http | Opt-in https stays. Changing the default would break working setups silently |
| RTMP publishing | Video and the camera's reusable secret | Third-party apps and encoders; some refuse a private CA | RTMPS added beside it on 1936, plain kept |
| SRT publishing | Video; the secret in the stream id | A publish passphrase must be set in every app, so turning it on breaks them all | Unchanged |
| Plain RTSP publishing | Video and credentials | Third-party publishers; forcing encryption also ends this computer's OBS on 8554 unless that moves to a loopback-only address | Unchanged; Rhema Studio Cam never uses it |
| Desk paired over http | Its key and signalling. Pairing reads `tls_port` over plain http, so someone on the path can strip it; the desk then says it is not encrypted | Hosts without https | Unchanged |
| Typed camera on another computer, and the TV's mixed content allowance | Signalling for that camera | Standalone MediaMTX boxes on http | Unchanged |
| Router's own WebRTC port 8889 reachable on the network | Plain signalling to anyone who connects; reading still needs a sign-in | Host screens use it by the LAN address; binding to loopback needs them moved first | Unchanged |
| SRT companion passphrase shared, renewed only on router restart | An unpaired companion that recorded traffic could still decrypt it until a restart | Per-reader passphrases need one path per companion; changing it live ends every companion's stream | Unchanged |
| NDI | Picture to anyone on the network | The NDI protocol | Unchanged |

## Next, if the owner wants it

These change what people must do, so none is on by default:

1. Offer https-only mode: refuse keys, feeds and camera signalling on 8080 from other computers.
2. Require https at desk pairing, comparing the certificate code on both screens.
3. Move this computer's OBS and screens to loopback, then bind 8889 to loopback.
