# ADR 0006 — Screens on TVs: browser feeds, Rhema Studio Receiver, and why not Google Cast (yet)

- **Status:** Accepted for what is built (#198; browser feeds since ARCH-002, Rhema Studio Receiver
  1.0–1.5, PRs #301, #336, #366 and `tv-067/receiver-polish`). Google Cast is out of scope until
  the owner asks again (§5).
- **Scope:** how a TV in the church shows a Rhema Studio output without a computer beside it: what
  travels over the network, which device runs what, how a TV is paired and revoked, and what an
  attacker on the church network can and cannot do.
- **Code:** `src/feed.ts` and `feed.html` (the feed page), `src/lib/browser-feeds.ts`,
  `src/lib/feed-receivers.ts`, `src-tauri/crates/api/src/http.rs` (`FeedHub`, the feed routes),
  `src-tauri/src/commands/join.rs` (`tv_show`, `tv_status`, `tv_discover`),
  `src-tauri/src/commands/tv_proof.rs`, `android-tv/` (the Receiver app).

## 1. Context

A church wants the words, the Bible and the camera on a TV in the foyer, the overflow room or on the
platform, and has a cheap Google TV stick in it, not a second computer. Three ways exist to get a
Rhema picture on that TV:

1. **A browser feed** opened by any browser: the TV's own browser, OBS Browser Source, a tablet.
2. **Rhema Studio Receiver**, our Android TV app, which opens the same feed full screen and keeps it.
3. **Google Cast**: a phone or computer "casts" to the TV, which runs a Cast receiver page.

Constraints from the owner (#198, #208): no internet or cloud dependency on a Sunday, nothing paid,
no Google account or developer registration required to run, state not pixels for text, cameras
straight from the church's camera router, and the main computer's show must never depend on a TV.

## 2. Decision

**Every TV screen is a browser feed; the native Receiver is the way to open one on a Google TV.**

- The host sends **state, not pixels**: each feed gets JSON frames (the verse, the theme, the scene,
  the stage payload, the host's clock) as server-sent events from the host's LAN listener
  (`/api/v1/feed/{id}/events`). The page draws them with the same renderer as the output windows.
  Cameras in a scene play straight from the camera router over WebRTC (WHEP); the host does not
  relay video. Text, timers and the ticker are drawn on the TV, so a still slide costs nothing on
  the network and a timer counts by the host's clock (beats every 3 s).
- **One page, two ways to open it.** OBS and ordinary browsers open the feed's link; a Google TV
  runs Rhema Studio Receiver, a small WebView app that opens the same page full screen, reopens it
  after a restart, survives network drops (retry loop) and announces itself on the network
  (`_rhema-tv._tcp`) so Rhema lists it. The renderer exists once.
- **Pairing by a code on the TV's screen** (1.2+): Rhema sends a feed only to a TV that proves it
  shows the code the operator typed (a PAKE-style exchange, `CodeProof`), so only someone who can
  see the TV assigns it. The link goes encrypted with that exchange's key, with the fingerprint of
  Rhema's own https certificate (1.3+); the TV opens the page only from a computer showing exactly
  that certificate.
- **Each TV its own key** (1.5, this change): a TV sent a feed gets a key of its own in its link.
  The listener accepts the feed's key (OBS, browsers, TVs paired before) or one of its TVs' keys.
  **Revoke** on one TV withdraws its key and cuts its stream at once; the page reloads, gets 403,
  and the Receiver goes back to its code screen. The other screens carry on. **New link** replaces
  the feed's shared key (cutting every page on it) but leaves the TVs' own keys alone.
- **What a screen does when it loses the host** is the output's choice: keep the last frame (the
  default, with the small "Not updating" mark), a library picture, or a countdown to the service
  start, shown after 10 s without a frame or a beat and gone as soon as the host is heard again.
  The Receiver also keeps one picture of the screen (a bounded JPEG in its own storage, at most
  1920×1080 and 4 MB, only for the feed it was taken of) and shows it at start until the host
  answers, so a TV restarted during a power cut does not show a code screen to the congregation.
- **Overscan** is per output (0–10 % of each edge), applied by the feed page, for TVs that crop.

## 3. Options compared

| | Browser feed (any browser) | Rhema Studio Receiver (native, ours) | Google Cast receiver |
|---|---|---|---|
| Runs on | Anything with a modern browser: OBS, tablets, smart TV browsers | Android TV / Google TV 7.0+ (sideloaded APK) | Chromecast and Google TV with Cast |
| Needs internet | No | No | Effectively yes: the receiver app is looked up by Google, the page must be hosted at a public https address, and Cast discovery and launch go through Google services |
| Registration | None | None (sideload; Play Store only with separate approval) | A Cast developer account (paid once), an application ID per receiver, devices registered for testing |
| How a TV is chosen | Someone opens the link on it (or a QR code) | Code on the TV's screen, checked by the host | The sender's Cast button; anyone on the network can cast to any TV |
| Keeps showing after a restart | Only if the browser reopens the page | Yes: reopens the last feed, last picture until the host answers, optional start with the TV | No: a cast session ends with the sender or a restart |
| Who can revoke | Only a new link (everyone on it) | One TV alone (1.5), or a new link | Ends when the sender stops |
| Certificate / privacy | The link is a secret; http or https | https pinned to Rhema's own certificate; link sent encrypted | Needs a publicly trusted certificate on a public address |
| Remote / TV UX | The TV browser's own (often poor: pointer, address bar, sleep) | Built for the remote: OK, ←/→; no pointer, no chrome | Good on the sender phone; the TV only shows |
| Cameras (WHEP) | Yes, where the browser decodes H.264 WebRTC | Yes (Android WebView; measured 1080p on a Chromecast GTV HD) | Possible in a custom receiver, untested; the receiver page would have to reach the LAN camera router from a public page (mixed content) |
| Our work | Done (one renderer) | A small app: WebView shell, pairing, NSD, cache | A second sender UI, a hosted receiver, Google registration, plus everything the Receiver does |

## 4. Threat model (the Receiver and its feeds)

Assumed attacker: someone on the church network (a guest on the Wi-Fi, a compromised device) and
anyone who saw a livestream or a photo of a TV. Not assumed: someone with the host computer's
desktop, or physical access to the TV with its remote for long.

| Threat | What stops it |
|---|---|
| Showing something on a TV (a hijack) | The TV takes a feed only after the code check with the code on its own screen; a code works only while on screen and 2 minutes after; 5 tries, then locked until OK is pressed; one /show per check, from the computer that did the check (`MainActivity.challenge/show`). |
| Reading a feed's link from the network | The link travels encrypted with the check's key (1.3); `/status` never returns the link, only the feed's id. Pages and events are served over https on the host's own certificate. |
| Standing in for Rhema (a fake host) | The TV opens the page only from the certificate whose fingerprint came in the encrypted /show; another certificate is refused with a plain message. |
| A web page on the network talking to the TV or the host | The Receiver answers no request with an `Origin` and only by IP-literal `Host` (DNS rebinding); JSON only, flat objects only, small bodies, 5 s per request, 3 at a time. The host refuses foreign origins and names (`same_origin_only`, `host_trusted`). |
| A leaked or photographed link | 1.5: a TV's own key can be revoked alone at once (stream cut, 403 from then on); the shared key is renewed with New link. Keys are 128-bit random, compared in constant time, never in backups or logs, not readable through the AI assistant (MCP outputs list no keys or addresses). |
| A TV used to operate Rhema | A feed key is read only: frames, its media files (only those its current frame names) and `/ack`. No command endpoint takes a feed key. |
| Private stage notes on a public screen | Stage fields are sent only to outputs whose role is stage; the TV list says "Private screen (stage notes)" or "Public screen". |
| The kept picture of a private screen | Stored only in the app's private storage, one file, replaced every minute, deleted when the TV is revoked (403) or sent another feed, and shown only for the feed it was taken of. Someone with the TV and adb debugging on could read it; the same is true of the WebView's own cache. |
| Start with the TV abused | Off by default, the boot receiver disabled in the manifest until turned on from the code screen with the remote; it only opens the app (which shows what it showed). |
| Denial of service on the LAN | Out of scope for a church network: a device flooding the Wi-Fi can stop any screen. The main computer's own outputs never depend on a TV. |

Residual risks, accepted: a TV paired before 1.5 keeps the feed's shared key until it is sent the
feed again (its row says so); the code check trusts that the person typing the code is looking at
the right TV (the address on its screen must match the one picked); a revoked TV still shows its
last picture until its page reloads (within a second when its stream is cut, or at its next
connection when it was offline).

## 5. Why Google Cast stays out of scope for now

- **It does not work offline.** A Cast launch resolves the receiver's application ID with Google,
  and a custom receiver is a page at a public https address. A church with the internet off (the
  owner's acceptance case: WAN unplugged before boot) could not start it.
- **It needs registration.** A Cast developer account, an application ID per receiver, test
  devices registered by serial: work and a dependency the owner ruled out ("no Google Cast
  requirement, paid SDK, cloud relay").
- **Pairing and revocation are weaker.** Anyone on the network can cast to a TV; a session ends
  when the sender's phone sleeps; there is no "this TV shows this feed until told otherwise".
- **It would add, not replace.** The Receiver, the browser feed and the renderer would all stay;
  Cast would be a second sender path and a hosted copy of the page to keep in step.
- **What would change the decision:** the owner asking for phone-initiated casting in a room with
  internet, and a test that a Cast receiver page can reach the LAN camera router and the host's
  https listener. Until then the native Receiver covers Google TV, and the browser feed covers
  everything else.

## 6. Consequences

- One renderer for windows, NDI, browser feeds and TVs; a feature drawn on the projector is drawn on
  the TV.
- The host keeps per-feed and per-TV keys in memory (`FeedHub`), from the outputs the app pushes
  (`feeds_set`); revoking is removing a key.
- The Receiver is ours to keep up: Android WebView changes, TV makers' power and boot rules (Android
  10+ may not let an app open itself at boot even when asked; the code screen says what it can).
- Measured on the integrator's Chromecast with Google TV HD (#213 rows 10fg, 10fl): 1080p scenes
  with a camera; 4K and 60 fps profiles are #213's.
