# ADR 0002 — Rhema Comms voice: full-duplex Push-to-Talk on the LAN

- **Status:** Proposed (C3 of #251; built on Host/Join, ADR 0001 §Host/Join, and Comms C1/C2).
- **Scope:** one LAN talk channel between the host's main desk and joined Rhema desks. Channels,
  private calls and phones are C4.

## 1. Requirements (from #251)

- Full duplex: several people hold Talk at once and all hear each other; nobody is muted or denied
  because someone else is talking. No floor lock.
- "Who's talking" from real voice activity, distinct from "Talk held".
- Intercom audio is a separate graph: never routed to OBS, NDI, the PA, the sound player, sermon
  transcription or Bible detection; never recorded, transcribed or summarised.
- LAN only: no cloud, no public STUN/TURN, no subscription, no new hardware.
- Talk stops on release, on window blur and on disconnect. Voice failing never touches the screens.

## 2. Decision

**The host is the hub and mixes.** Each joined desk keeps one WebRTC peer connection to the host
with one bidirectional Opus audio track. The host receives every desk's microphone and, for each
listener, sums everyone else (and the main desk's own microphone) in WebAudio into that listener's
outgoing track, leaving out the listener's own voice. The main desk hears the sum of all joined
desks. So any number can talk at once, each desk sends one track and receives one, and nothing is
renegotiated when someone starts or stops talking.

- *Rejected: mesh* (every desk to every desk): N² connections and N decodes per desk; it grows badly
  past four desks and needs signaling between joined desks that otherwise only talk to the host.
- *Rejected for now: an SFU* (forwarding each track): it needs a media server or renegotiation per
  speaker; mixing on the host is enough for a church crew (2–8 desks). Revisit if the Intel host's
  CPU shows strain with 6+ desks (#251 asks for that benchmark).

**Signaling over the existing Host/Join listener.** `POST /api/v1/voice` with the desk's key carries
a complete SDP offer (ICE gathered first: LAN host candidates only, `iceServers: []`); the host's
window answers through a Tauri command and the HTTP request returns the answer. No trickle ICE, no
extra channel. Role checks are those of Host/Join: any paired desk may join the talk channel.

**Talk = the microphone track enabled.** Key-down enables the track, key-up disables it (silence is
sent, the connection stays). The talk state travels as a small command so everyone sees "Talk
held"; the host measures each incoming track's level (an AnalyserNode) to show who is actually
audible. Both go out in the Live State (`voice: [{ name, talking, speaking }]`).

**Isolation.** The intercom uses its own `getUserMedia` stream (echo cancellation, noise
suppression on) and its own `AudioContext`; its output is an `<audio>` element on the default
output, with nothing connected to the sound player, outputs, NDI, recording or listening. Selecting
a separate headset output is C4 (WebKit's `setSinkId` support is to be checked).

## 2a. Channels and private calls (C4)

Everyone is in All crew; Production and Stage & worship are heard unless a desk unticks them; the
main desk hears every channel. A speaker talks to All crew, one channel, or one person
(`to:<name>`, `to:host`). The host keeps one gain node per speaker → listener pair and sets each to
1 or 0 by that rule (`rewire`), so joining, leaving or changing channels never renegotiates WebRTC.
Desks send their choice with `voice_channels {listen, talk}`.

Verified in the app (2026-10-23, tones over the real listener): A to Production was heard by B
(listening) and not C; A privately to C was heard by C only; B to All crew by A and C.

## 3. Phones (C4) — needs an owner decision

**Built (2026-10-23):** the phone remote page joins the talk channel and holds to talk wherever the
browser allows its microphone (a secure page), with the same signaling and release rules as a desk;
on a plain-http page it says why it cannot. Checked with headless Chrome (fake microphone) against
the QA build over `http://127.0.0.1` (a secure context): it joined in about 1 s, the crew marks
followed each press and release, and a listening desk heard the phone only while it held Talk.
What remains is serving the page securely on the LAN, below.

Browsers allow the microphone only in a secure context. The phone remote page is served over plain
HTTP on the LAN, so a phone cannot talk until the listener can serve HTTPS with a local certificate
(a self-signed one shows a warning each phone must accept once; a local CA must be installed on each
phone). Text notices and action requests already work on phones without it.

## 4. WebKit findings (Intel Mac, 2026-10-23)

- A new `AudioContext` starts suspended; a stream source created before it runs stays silent for
  good. The hub waits for the context to run before wiring a desk.
- WebKit processes only nodes that reach the context's output; a meter hanging off to the side
  reports stale levels (about a second late). Every meter is on a path to the output.
- One WebAudio↔MediaStream bridge costs about 60 ms; WebRTC on the LAN about 30 ms per hop
  (jitter buffer 28 ms, no loss). Desk → host mix → desk measured 210–260 ms on the audio clock
  with test tones (one bridge more than a real microphone has).
- Page timers are throttled heavily while the screen is locked; timings must be taken on the audio
  clock (`playbackTime`), not with timers.
- **Open risk: delay building up.** Measured again over eight bursts (2026-10-23, screen locked, all
  desks in one QA window, tone tracks made in WebAudio): desk → host → desk grew from about 200 ms
  to about 2.5 s within 15 s, on the #270 build as on later ones. A plain WebRTC loop between two
  connections in the same page, with no host and no Rhema mixing, grew the same way (281 → 1535 ms),
  so it is WebKit's audio pipeline in this setup, not the hub's mixing or routing. Whether it
  happens with real microphones, on two computers, with the screen unlocked, is not known: measure
  that first in the physical rehearsal (#251). If it does, candidates are resetting a desk's
  connection when its delay grows (the host can see it in `getStats`) and sending without WebAudio
  on the desk side.
- **Where it builds up (measured 2026-10-23):** in the receiver's jitter buffer. Its delay grew
  323 → 1222 ms against a 40 ms target while WebRTC kept dropping samples to catch up
  (`removedSamplesForAcceleration` rising): audio arrives faster than the receiving side plays it
  out, about 10% slow, far beyond clock drift; consistent with the locked screen throttling WebKit's
  playout. A second consumer of a remote track (a muted `<audio>` element) made it grow from the
  first seconds; with WebAudio alone a direct loop held ~121 ms (jitter buffer ~45 ms) for four
  rounds before growing. The hub no longer adds that element; desks still hear everyone (three-desk
  test). Across processes (headless Chrome as a phone → the QA host) the same build-up showed.

## 5. Verification

- Automated in the app (QA build, 2026-10-23): three test desks (paired keys, the real LAN listener)
  with tones at 440 / 660 / 880 Hz. Silent until someone holds Talk; each desk alone is heard by the
  other two at −28 dB and hears nothing itself; all three at once: each hears the other two at −28 dB
  and its own pitch only at the codec floor (−75 to −82 dB); letting go removes that desk for
  everyone; the "who is talking" marks matched every step; leaving drops a desk at once. Latency on
  the audio clock: 201–204 ms desk → host mix → desk, steady.
- Real audio (two headsets and a phone, echo, CPU on the Intel host) needs a physical rehearsal and
  is not claimed from the automated check.
