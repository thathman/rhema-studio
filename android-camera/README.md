# Rhema Studio Cam (Android)

(Called Rhema Camera before 1.1. From 1.7.0.0 the package is `com.airixmedia.rhema.camera` (developer: Airix Media — Hendrix Nwaokolo); a phone with an earlier `com.openbezal.rhema.camera` build installs it beside the old one, pairs once, then uninstalls the old one. The `rhema-camera://` link is unchanged.)

A phone camera app for Rhema Studio (#209). The screen shows the camera's picture and nothing else;
everything else is in Settings. It sends to the camera router that comes with Rhema (MediaMTX),
encrypted, on the church network only. Rhema's scenes and TVs and OBS take it from there as they take
any camera.

Version 1.7.0.0 · package `com.airixmedia.rhema.camera` · Android 8 (API 26) and newer · target API 34.

## Using it

1. In Rhema: **Settings → Remote Control**: turn on the network listener and **Secure page for phones
   (https)** (this makes Rhema's certificate, which the camera router also uses). **Live → Production
   tools → Cameras**: add a camera; its card shows **Rhema Studio Cam app (Android)** with a QR code and
   a link, and **Quality for Rhema Studio Cam** (below).
2. On the phone: scan the QR code with the phone's camera or Google Lens and open it in Rhema Studio Cam
   (or copy the link and paste it in **Settings → Connection → Paste the pairing link**). Confirm
   **Pair**. The app goes live at once (unless **Start sending when the app opens** is off).
3. The viewfinder: **tap** to focus and expose there (the focus then holds), **double-tap** to follow
   the scene again, **pinch** to zoom (below 1× on phones with an ultra-wide lens, Android 11+). The
   dot top left is the tally, in the same words as Rhema Studio and its Companion: **ON AIR · OBS** /
   **ON AIR · CONGREGATION** / **ON AIR · OBS, CONGREGATION** (red: OBS has this camera in
   Program / a Google TV shows it), **RHEMA RECEIVING** (teal: Rhema Studio says its camera router
   gets the picture, on no Program), **SENDING · NOT RECEIVED YET** (amber: sent, but Rhema's router
   has nothing from it yet), **SENDING** (teal: a Rhema Studio before 1.4 that does not say),
   **SENDING · NO TALLY** (Rhema has not said, or is older), **CONNECTING** (amber), **NOT SENDING**
   (grey; with the reason underneath when it stopped by itself). A projector Rhema drives from its own
   window is not counted (it reports nothing). Tap it to start, hold it to stop. The gear opens
   Settings; the moon blacks the screen out. The name under it is what Rhema Studio calls the camera
   (from 1.4; before, the name in the pairing link).
   Under the dot an amber badge says **HOT**, **VERY HOT**, **COOLING** or **BATTERY 15%** while the
   phone is hot (Android's thermal status moderate or worse), sends less to cool down, or has under 20 %
   battery and is not charging. It stays until that is over (tap it for what to do).
4. Keep the phone on a charger on a stand. It may lock: the viewfinder shows over the lock screen
   (Settings asks for the PIN; turn it off in Settings → On screen → Show over the lock screen), and
   sending carries on with the screen off.

## Restarts, removal and Rhema Studio's suggested quality (1.4)

- **Restarts** (#836): the sending service is sticky, so if Android ends the app while it sends, it is
  started again. After the phone restarts or the app is updated while it was sending, a notification
  says it was sending "when the phone restarted" / "when the app was updated" · **Tap to send again**.
  From Android 11 that is all Android allows (a background app may not open the camera); Settings →
  Connection → **Offer to send again after a restart** (on) turns the notification off. On Android 8–10
  the notification is the default too; only if the person turns **Send again by itself after a
  restart** on (off by default) does the camera go live again with nobody touching the phone. A stop
  you make (hold the dot, Stop sending, the notification's Stop) is never undone by a restart. The
  viewfinder is exported (for pairing links), so the tap carries a random one-time nonce kept in the
  app's private settings: another app opening the viewfinder with a "resume" extra cannot start
  sending, and the tap resumes only while it is still wanted (paired, was sending, setting allows).
- **Removed or given a new link** (#836): when Rhema Studio answers three times running that it does
  not know this camera (its tally reply is 403; any other answer, or no answer, breaks the run), the
  app stops, shows **NOT SENDING** with the reason, and does not resume after a restart. Fallback when
  the tally cannot be read: the camera router has refused its sign-in (401 only; never a 400, 404 or
  503 while the router restarts) for at least 90 s with no success between, and Rhema has not said in
  the last minute that it knows the camera. A pairing link without a report port never stops on the
  router alone. Just after Rhema starts (before it has its camera list) it answers 503, not counted.
- **Suggested quality** (#838): Live → Production tools → Cameras → **Quality for Rhema Studio Cam**
  per camera: The phone decides, **TV-friendly 720p, lower bitrate** (at most 720p, 4 Mbit/s), 1080p
  moderate (8 Mbit/s) or Light 720p (2 Mbit/s). It comes with the tally (every 2 s) and is a ceiling
  over the size and bitrate set on the phone. A lower bitrate applies at once; a smaller size restarts
  the stream, so it waits until Rhema says the camera is on no Program (not online, not on a TV).
  Settings → Picture shows it and has **Follow Rhema Studio's suggested quality** (on).

## When Rhema Studio's address changes (1.6, doc 48)

- **Pinned by Rhema's server key.** A pairing link from Rhema Studio with doc 48 carries `key=`, the
  SHA-256 of Rhema's server key (SubjectPublicKeyInfo); the camera then trusts only that key, for the
  picture (RTSPS) and the battery, heat and tally (https). The key stays the same when Rhema's address
  changes or its certificate is renewed. A link from before (`fp=` only) trusts that one certificate
  until it first completes a connection, then keeps its key (the saved link gains `key=`); nobody
  has to scan again. A malformed `key=` is refused.
- **Finding Rhema again.** While the camera should be sending and Rhema's camera router has not
  answered for about 10 s (an answer that refuses, such as a wrong password, means Rhema is still
  there, so it does not look), it browses the network for `_rhema-host._tcp` for 30 s (up to 60 s
  while addresses still wait for their check), skips any Rhema
  whose `k=` hint is not the start of its key pin, and checks each IPv4 address left (at most two per
  announced name, the last-known one first; one turned away from a full queue is kept aside and
  checked later in the same browse) with a full TLS handshake on the camera router's port
  that only the pinned key completes (4 s in all per check). Only then does it change the saved
  address (nothing else in the link) and connect there as the same camera. Between browses it rests
  15 s, 30 s, 60 s, then 120 s. It stops when it sends again or sending stops. After 2 minutes of
  looking the status says "Rhema Studio may have moved; scan the camera link again if this
  continues". A camera still holding only a certificate pin cannot look (its certificate does not
  say its key until it has connected once at the old address).

## The look

Every frame goes through the phone's GPU before the encoder: the camera draws into a texture, one
shader pass grades it into the encoder's input surface at the sending size, and the same pass draws
the viewfinder while the screen is on, so what you see is what is sent. Looks: **Studio** (default:
clean broadcast, neutral, gentle contrast, true skin), **Cinematic** (filmic curve, soft highlights,
teal shadows and warm highlights, a gentle vignette, −0.3 EV to keep highlights), **Warm Sanctuary**,
**Natural**, **Black & White** and **Off**, each with a **Strength** slider, plus **Warmth** and **Tint**
fine-tune, optional **film grain**, and a **letterbox** guide (2.39:1, 1.85:1; burnt into the picture
only if chosen). **Advanced** loads your own 3D `.cube` look (up to 64 points).

How it stays cheap: the colour part of a look (white-balance fine-tune, tone curve, saturation and
skin-safe vibrance, split toning, black and white) is computed in Java (`Looks.java`, tested by
build.sh) and baked into a 17³ table whenever a setting changes; the shader only looks the colour up
(two texture reads), then adds the vignette, grain (a small noise texture) and bars. With a look on,
the camera's own sharpening is turned off and its noise reduction is the best that keeps the frame
rate. Never a LOG profile; 8-bit colour, never HDR.

The look runs once per camera frame, never twice. On a frame only the encoder takes, it grades
straight into the encoder's surface; on a frame the viewfinder (or the histogram) also takes, it
grades into a texture at the sending size, copies that to the encoder first and then to the
viewfinder at the screen's size. The viewfinder is a SurfaceView (the display hardware shows it, at
no GPU cost), its swaps never wait for the screen's refresh, and a viewfinder frame is left out when
its last one is still on the GPU or the frame is over its time (but it is drawn at least 4 times a
second). The histogram is a 64 × 36 copy of the graded picture read twice a second, only while it is
shown.

## Picture and sending

- **Presets** (only those the camera can hold exactly): Cinematic 24, Film 25, Smooth 30, Sports 60.
- **Size**: the largest the camera and a hardware encoder both do at that frame rate (4K, 1440p,
  1080p, 720p). **Codec**: always H.264 High by default, on every phone: Rhema's screens and the
  Google TV play cameras over WebRTC, which may not decode HEVC, and a blank camera on a Sunday is
  worse than a little efficiency. Settings → Picture → Advanced offers "HEVC (best quality, for OBS
  only — Rhema screens and TVs may not show it)". A full picture every second, no B-frames, constant
  bitrate where offered.
- **Bitrate**: worked out from size and frame rate (4K24 ≈ 48 Mbit/s H.264, ≈ 40 if HEVC is chosen;
  1080p30 ≈ 14), never above the encoder's limit or about 45 % of the Wi-Fi link. If the network
  cannot keep up, frames are dropped from the queue, the encoder is asked for a full picture, and the
  bitrate steps down by a quarter (to a third at most), coming back 10 % every 15 s once it is quiet.
- **Exposure**: **Film shutter** (default where the camera allows manual exposure): the shutter stays
  near 180° (1/48, or 1/50 under 50 Hz lights; 1/60 under 60 Hz) and the ISO follows the light from a
  tiny copy of the picture twice a second. It starts by letting the camera measure for 1.5 s and then
  holds that white balance (some phones stop their automatic white balance while exposure is manual);
  **Measure the light again** repeats it. Also **Automatic** (brightness ±, hold) and **Manual** (ISO,
  shutter, "Match the light now"). Anti-flicker: automatic (50 Hz if unsure), 50, 60 or off.
- **White balance**: automatic (with hold), daylight, cloudy, tungsten, fluorescent, or **Kelvin**
  2500–10000 where the camera allows manual colour (worked out from the camera's own daylight and
  tungsten measurements, taken once per camera).
- **Focus**: follows the scene (continuous video focus), tap to hold, or a manual distance.
- **Stabilisation**: optical and electronic, each where the phone has it; off by default (a tripod
  needs none).
- **Sound**: the phone's microphone as AAC (48 kHz mono), off by default: the church sound desk has
  the sound.
- **Sending**: RTSP over TLS (RTSPS) to `rtsps://<Rhema>:8322/<camera>`, ANNOUNCE / SETUP / RECORD,
  RTP over TCP interleaved (H.264 RFC 6184 FU-A, H.265 RFC 7798 FU, AAC RFC 3640), SDP with the
  parameter sets, RTCP sender reports, signed in as `cam-<camera>` with its secret (Digest or Basic,
  always inside TLS). Only the certificate whose SHA-256 is in the pairing link is accepted; there is
  no plain-RTSP fallback. It reconnects by itself (1, 2, 4 … 30 s) and a clean stop sends TEARDOWN.
  The pairing link (with the camera's secret) is kept in the app's private settings, excluded from
  backups, and never written to the log.

## Battery, heat, screen off

- **Screen off** (the moon): the screen goes black at the lowest brightness and the viewfinder is not
  drawn at all; the GPU draws for the encoder only. Touch to wake.
- **Power button**: while sending, the app is a foreground service (notification "Rhema Studio Cam is
  sending", with Stop) holding a partial wake lock and a high-performance Wi-Fi lock, so sending
  carries on with the display off. From Android 9 only a foreground service may use the camera in the
  background; Android 14 needs the camera/microphone service types, which the app declares. Some makers
  (Xiaomi, Huawei, Samsung's "sleeping apps") still stop apps unless allowed: Settings → Battery and
  heat has a shortcut.
- While sending, the viewfinder draws at most 15 times a second. If the GPU still runs over its time
  for about a second, the look gets lighter step by step: the viewfinder at most 15, then the film
  grain off, then the viewfinder at most 8 a second; half a minute of calm steps back. Settings →
  Picture then says **Lighter look on this phone…**. The encoder is never slowed on purpose; if it
  still cannot keep up, Settings says how many frames a second it sends and suggests a smaller size or
  frame rate.
- On the test phone (Snapdragon 430) a look costs about 10–13 ms of GPU time per 1080p frame beyond
  Off (about 30 ms against 17): at 1080p30 the encoder gets 29 of 30 frames and the viewfinder about
  7 a second; at **Cinematic 24** (the default) the encoder keeps 24 and the viewfinder about 11.
  Phones from the last few years have several times this GPU.
- **Heat** (Android 10+): bitrate −30 % when the phone is warm; at most 1080p and 30 fps when hot;
  720p when very hot. Settings shows battery %, temperature and the battery current.
- **Told to Rhema Studio** (1.2): while sending, every 30 s the app tells Rhema Studio the battery %,
  whether it is charging, the battery temperature, Android's heat level and whether it is cooling the
  phone. It goes over https to Rhema Studio's secure listener (the port is in the pairing link as
  `api=`; the same pinned certificate as the picture), signed in with the camera's own secret in a
  header, never in the address. Live → Production tools → Cameras and Show health show it and warn when the
  battery is under 20 % and not charging, or the phone is hot. A link made before this version has no
  `api=`: pair again (scan the camera's Rhema Studio Cam QR code) to turn the report on.

## Building

```
JAVA_HOME=<JDK 17> ANDROID_HOME=<SDK with platforms;android-34, build-tools;34.0.0> ./build.sh
adb install -r build/rhema-camera.apk
```

No Gradle, like `android-tv/`: aapt2, javac (Java 8, no lambdas), d8, zipalign, apksigner with a local
debug key (`~/.android/rhema-camera-debug.jks`). The build first runs `test/…/CameraCoreCheck.java` on
the computer: the pairing link and certificate pin, RTP packets (FU-A/FU fragmentation and marker
bits), SDP, Digest sign-in (RFC 2617's example), the RTSP reply reader, the bitrate and shutter
plan, kelvin white balance, every look's colour maths (tone curve rising, mid-grey kept at 0 %, skin
hue kept, black and white, the baked table matching the maths), `.cube` tables and the film
shutter's meter. A failure stops the build. `build/` is git-ignored: never commit the APK.

For checking from a computer: `adb shell am start -n com.airixmedia.rhema.camera/.MainActivity --es look
cinematic --es ae film --es preset smooth30` picks a look, exposure mode or preset.

## Tested on

Vsmart V340U (Android 10, Snapdragon 430 / Adreno 505), against MediaMTX v1.21.2 with RTSPS on 8322
(see the PR for the figures): 1080p24 and 1080p30 H.264 High; no HEVC encoder and no 4K on this phone
(its encoder stops at 1080p30, 20 Mbit/s); manual ISO/shutter, kelvin and manual focus available.
