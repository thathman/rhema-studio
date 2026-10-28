# 30 — Connected device family overhaul & real-hardware acceptance

**Target UX specification, not a shipped feature claim.** Owner explicitly wants a major visual and interaction overhaul of all **three apps whose source is already in this repository**. Read #445, #401, #197/#198/#208/#209/#213, [handover](../CODEX-UNIFIED-HANDOFF.md).

## Existing source and implementation boundaries

| App | Location | Current core technology and contract | What must remain |
| --- | --- | --- | --- |
| **Rhema Studio Receiver** | `android-tv/` | Android/Java WebView-based dedicated TV presentation receiver, local mDNS, short-code pairing and encrypted host-assigned feed URL, cached last frame | Read-only designated output; cert pinning, TV-local code proof, per-receiver revocation, remote navigation, boot/connection recovery, real WebRTC camera layers |
| **Rhema Studio Cam** | `android-camera/` | Android/Java native camera/MediaCodec/GPU publishing via encrypted RTSP to bundled MediaMTX | One persistent named feed published once; camera controls, stabilization/exposure/white balance, LUT/looks, thermal throttling, background service, network reconnect, battery status |
| **Rhema Studio Companion** | `companion-app/`, `src/studio/companion/`, `src/lib/obs-companion.ts` | Tauri/Rust + React; secure paired host and certificate, OBS WebSocket, host MediaMTX SRT credentials and independent OBS camera scene/source additions | OBS edits scoped to local OBS, not congregation; clean source names, reconnect, credential security, OBS on-program/preview tally, no automatic overwriting user-created scenes |

All three should use the approved receiver-style R mark and product names from `brand/`. Package IDs remain stable for existing user installs unless migration/upgrade tests establish a safe transition. Branding may be in review PR #422; compare its assets before copying. Keep the existing native media pipeline while improving UI; do not switch to a WebView camera publisher just to reuse frontend components.

## 1. One topology, separate productions

```text
Phone Pulpit ── RTSPS ──┐
Phone Choir  ── RTSPS ──┼─> bundled local MediaMTX ───> Main Rhema Live / congregation scene
IP camera    ── RTSP ───┘                        └────> Google TV receiver(s) (WHEP / browser)
                                                 └───> Companion/OBS PC (SRT media source)
                                                                      └──> YouTube 720p30
```

Two independently selectable camera compositions:
- **Sanctuary / congregation:** Rhema owns camera cuts and visual overlays, draws large bilingual Bible/lyrics, lower thirds, ticker, timer, PiP and signage on local receiver screens.
- **Online / OBS:** OBS operator chooses cameras and its own scene program and lower thirds. Rhema exports the content/graphics as distinct browser/NDI variants. OBS's YouTube program is **not** the source for sanctuary TVs.
- Default initial proof **1080p30 sanctuary**, online OBS **720p30**, 1080p60 sanctuary only after camera capture/decode/display real measurement. MediaMTX is a relay and is not an automatic transcoder.
- WAN must be unplugged before startup in one acceptance test; no video upload to internet is required except optional final YouTube stream. The unrelated Rhema Engage mobile-data quiz is intentionally online (#425).

## 2. Shared visual language without same layout everywhere

**Design tokens:** neutral charcoal/stone/warm white, restrained teal controls, LIVE red only for genuine live status, amber warnings, green operational connectivity (when semantically appropriate), typography legible at viewing distance. No purple/violet synthetic gradients or ornamental dashboard clutter.

**Consistent semantic names:** Find Studio, Pair securely, Assign output/camera, Connecting, Connected, Sending, Receiving, OBS Program, Congregation Live, Preview only, Recovering, Offline/Last frame. Every indicator includes words/icons, not color alone. Never claim a stream is on-air from the mere presence of a receiver.

**One host Connections hub** (#401 / existing PR #437) owns device IDs, discovery, pairing/revoke and roles; other apps present product-appropriate steps and connect to the same host authority. No independent cloned host-pairing settings pages; legacy flows link to canonical hub. Offer discover-on-LAN, secure QR/code or manual entry where appropriate. Show certificate identity/verification when a user is making a sensitive first connection. Never show tokens in screenshots, logs, pasteable public display URLs or receiver status.

## 3. Receiver — remote-first 10-foot UX

A TV is mostly an **output, not an editing computer**. Four scenes:
1. **Unpaired:** approved landscape Rhema Studio Receiver logo; large name, code, network/host status and brief "In Rhema Studio → Connections → Add TV" instructions. Navigate with D-pad + OK; code expiry and retry policy clear. Pairing does not require a mouse.
2. **Showing assigned output:** real fullscreen local output, no address bar, hidden settings chrome. A stage-role receiver stays stage-private; a congregation receiver never displays private notes. Video/audio rules: local WHEP clean camera scene; sanctuary audio muted by default; optional overflow audio requires explicit latency/echo configuration.
3. **Interrupted:** maintain last-good frame with low-distraction "Not updating" mark and elapsed age; or play a preapproved church fallback graphic / countdown chosen by output settings. Never silently display an unapproved preview, unrelated scene or stale private stage content. Explain connection/revoke states to the operator, not primarily the audience.
4. **Device settings/diagnostics:** via deliberate remote action, identifier, role, network, pairing/revoke, overscan and safe area, measured effective decoded FPS/drops, input latency, display resolution and reconnect testing.

From host Connections choose **Identify TV**, show a temporary clearly numbered output identifier on exactly that receiver; must not broadcast private control UI to all TVs. Test reboot/start-with-TV, certificate renewal, revoked pairing and 24-hour burn-in at actual hardware profiles.

## 4. Cam — native camera UX, not settings-first engineering interface

**Initial interaction:** remembered paired destination if authorized; if new, QR pairing in seconds with a privacy/security confirmation and working no-signal state. Then **full viewfinder** with small legible quality + actual sending tally. Top shows camera name, Sending/Not Sending/Reconnecting, battery and thermal if available; camera picture remains main surface.

**Controls:** big unambiguous Start/Stop (protect accidental stop by hold or confirmation), flip camera where supported, tap-to-focus/AE, pinch zoom, exposure, white balance, Looks/LUT with strength, bitrate/quality preset, stabilization, screen blackout/low-power mode. Put technical controls in an accessible drawer and reduce their default visibility. Test permission denial, background/lock screen and every relevant Android API level.

**Truthful tally:** distinguish encoding/sending to MediaMTX vs verified host receiving vs **Sanctuary Program** vs **OBS Program/Preview**. Host can publish authorized program tally to paired camera; if unavailable, show "Unknown", not a false red LIVE. Operator should see actual frames encoded/sent, bitrate, dropped frames, thermal mitigation, charging and power state.

Keep existing Java CameraService/GPU/MediaCodec/RTSPS/credentials intact initially. Separate UI modernization (native views or a planned framework change) from capture/codec refactors; benchmark before/after battery/temperature/FPS, and prove camera not stopped when app UI closes.

## 5. Companion — desktop OBS bridge

**Start/connection:** concise onboarding:
1. Discover and securely pair the main host (host certificate fingerprint verification) and grant OBS companion role.
2. Detect/local-connect **OBS 30+ via WebSocket**, explain enablement and authentication if not configured.
3. See available named cameras/graphics feeds, confidence/receiving/tally and expected bandwidth; **Add to OBS** into selected existing scene or new scene.
4. Test the source, monitor receiver health, reconnect when host restarts or router rotates credentials. Do not reorder/delete existing OBS inputs as side effect.

**Main view** should show host and OBS connection independently, list camera sources with meaningful states and measured receiving, selected camera preview if hardware budget permits (otherwise don't fake thumbnail), SRT delay/transport under Advanced, OBS Program/Preview tally, actions Add / Update / Test / Reconnect / View in OBS. Existing CompanionScreen and OBS source utilities should remain the foundation.

**Extend catalog** beyond cameras to correctly typed **Rhema Browser Source** variants: Bible lower third, Lyrics, Hymn, Title/Speaker Lower Third, Ticker, Fullscreen Bible/Slides, Timer/Countdown, per-role approved graphics. For OBS browser sources, use existing secured feed URLs/scopes; prefer independent per-source outputs and honor the existing authorized OBS settings. The same Live Bible change updates every following lower-third browser feed; there is no manual per-verse OBS source creation. Avoid silently pushing the congregation camera cut into online OBS.

**Backward compatibility:** standalone Companion (small installer) and Companion mode inside the full Rhema install both remain, but use the **same** UI/behavior. Preserve keychain certificate pinning, legacy pairing migrations, tray/autorun and stable camera input mapping. Fix old branch instructions in `companion-app/README.md` (#408).

## 6. Physical acceptance matrix

| Scenario | Must demonstrate / instrument |
| --- | --- |
| First install + pairing | Host sees nearby Google TV and two phone cameras; secure pairing/code, naming, scoped roles, easy manual recovery |
| Cold start with WAN unplugged | Two real phones publish named sources to local MediaMTX, TV shows approved congregation program, separate OBS PC sees both sources, stage and timer work |
| Independent camera cuts | OBS on Pulpit and Sanctuary on Choir; switch one without switching the other. Report actual scene and tally |
| Graphics variants | Live Bible EN+YO fullscreen sanctuary + EN lower-third OBS + private Stage time/note, all from one source change |
| Fault recovery | Kill/restart camera publisher, host listener/router, Companion, OBS and TV; approved last-frame/fallback, no unauthorized Take, watch reconnect |
| Video quality/latency | Actual capture, encode, router receipt, decoded/displayed FPS, drops, jitter, camera-to-screen latency and TV audio mute measured—not guessed from settings |
| Installation/branding | Upgrade existing app via same package IDs, show exact product name/approved mark on phone/TV/Companion, readable TV remote controls |
| Security | Wrong/revoked pair code fails, old URL/token invalid, no private stage notes on public receiver or logged camera secret, scoped OBS control |
| Accessibility/performance | D-pad-only Receiver, touch camera controls with TalkBack labels, desktop keyboard with focus, no viewfinder-induced codec drop, 60-min soak |

Mark each result **not tested / device-specific passed / failed** with date, device, firmware/OS, source resolution/framerate and test evidence. Unverified 1080p60 remains a future capability. Roll out as small PRs and preserve the current reliable pipeline until measured parity.

**Related**: #445, #401, #197, #198, #208, #209, #213, #411, #442; see [delivery matrix](31-codex-delivery-matrix.md).
