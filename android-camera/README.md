# Rhema Camera (Android)

A phone camera app for Rhema Studio (#209). The screen shows the camera's picture and nothing else;
everything else is in Settings. It sends to the camera router that comes with Rhema (MediaMTX),
encrypted, on the church network only. Rhema's scenes and TVs and OBS take it from there as they take
any camera.

Version 1.0.0.0 · package `com.openbezal.rhema.camera` · Android 8 (API 26) and newer · target API 34.

## Using it

1. In Rhema: **Settings → Remote control**: turn on the network listener and **Secure page for phones
   (https)** (this makes Rhema's certificate, which the camera router also uses). **Production →
   Cameras**: add a camera; its card shows **Rhema Camera app (Android)** with a QR code and a link.
2. On the phone: scan the QR code with the phone's camera or Google Lens and open it in Rhema Camera
   (or copy the link and paste it in **Settings → Connection → Paste the pairing link**). Confirm
   **Pair**. The app goes live at once (unless **Start sending when the app opens** is off).
3. The viewfinder: **tap** to focus and expose there (the focus then holds), **double-tap** to follow
   the scene again, **pinch** to zoom (below 1× on phones with an ultra-wide lens, Android 11+). The
   dot top left is the tally: **LIVE** (red), **CONNECTING** (amber), **NOT SENDING** (grey); tap it
   to start, hold it to stop. The gear opens Settings; the moon blacks the screen out.
4. Keep the phone on a charger on a stand. It may lock: the viewfinder shows over the lock screen
   (Settings asks for the PIN), and sending carries on with the screen off.

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

## Picture and sending

- **Presets** (only those the camera can hold exactly): Cinematic 24, Film 25, Smooth 30, Sports 60.
- **Size**: the largest the camera and a hardware encoder both do at that frame rate (4K, 1440p,
  1080p, 720p). **Codec**: HEVC where the phone's hardware encodes it (H.264 otherwise; Advanced can
  force H.264, which every Rhema screen and TV plays). High profile, a full picture every second, no
  B-frames, constant bitrate where offered.
- **Bitrate**: worked out from size and frame rate (4K24 ≈ 45 Mbit/s H.264, ≈ 38 HEVC; 1080p30 ≈ 14),
  never above the encoder's limit or about 45 % of the Wi-Fi link. If the network cannot keep up,
  frames are dropped from the queue, the encoder is asked for a full picture, and the bitrate steps down
  by a quarter (to a third at most), coming back 10 % every 15 s once it is quiet.
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
- **Power button**: while sending, the app is a foreground service (notification "Rhema Camera is
  sending", with Stop) holding a partial wake lock and a high-performance Wi-Fi lock, so sending
  carries on with the display off. From Android 9 only a foreground service may use the camera in the
  background; Android 14 needs the camera/microphone service types, which the app declares. Some makers
  (Xiaomi, Huawei, Samsung's "sleeping apps") still stop apps unless allowed: Settings → Battery and
  heat has a shortcut.
- While sending, the viewfinder draws at most 15 times a second, and less if the GPU is short of time,
  so the encoder always gets every frame.
- **Heat** (Android 10+): bitrate −30 % when the phone is warm; at most 1080p and 30 fps when hot;
  720p when very hot. Settings shows battery %, temperature and the battery current.

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

For checking from a computer: `adb shell am start -n com.openbezal.rhema.camera/.MainActivity --es look
cinematic --es ae film --es preset smooth30` picks a look, exposure mode or preset.

## Tested on

Vsmart V340U (Android 10, Snapdragon 430 / Adreno 505), against MediaMTX v1.21.2 with RTSPS on 8322
(see the PR for the figures): 1080p24 and 1080p30 H.264 High; no HEVC encoder and no 4K on this phone
(its encoder stops at 1080p30, 20 Mbit/s); manual ISO/shutter, kelvin and manual focus available.
