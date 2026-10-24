# Cameras on the church network (#209)

Rhema can take live pictures from phones (and IP cameras) on the church's own Wi-Fi and show
them in congregation scenes, on TVs and in OBS, without any app to buy and without the internet.

## How it fits together

- **The camera router** is a small program that comes inside Rhema (MediaMTX, free and open
  source, MIT licence). Rhema starts it, watches it and stops it when Rhema closes.
- **Each camera sends its picture once** to the router. One phone films one angle: pulpit,
  choir, wide…
- **Everything else takes the cameras it wants from the router**, each on its own:
  - Rhema's scenes and the TVs (WebRTC, "WHEP" addresses),
  - OBS for the livestream (RTSP addresses).

  Cutting from pulpit to choir in Rhema does not change OBS, and the other way round.
- Nothing goes to the internet: phones, router, OBS and TVs talk only on the church network.
  There is no account, no cloud service and no STUN/TURN server.

## Before the service

1. **Settings → Remote control:** start the HTTP listener with "Accept commands from other devices
   on this network" and "Secure page for phones (https)" ticked. Phones only let a secure page use
   their camera. (Pair a phone or set a key there first, as for the phone remote.)
2. **Production → Cameras → Add a camera:** type a name (Pulpit, Choir, Wide) and press Add camera.
   The camera router starts by itself once a camera is added (untick "Start it with Rhema while
   cameras are added" to start it by hand with **Turn on**).
3. **On the phone for that angle** (on the church Wi-Fi): scan the camera's QR code. The first time,
   the phone warns that the page is not trusted: accept it, or install Rhema's certificate once
   (open `http://<this computer>:<HTTP port>/rhema-ca.pem` on the phone). Allow the camera, choose
   back or front camera and 720p (recommended) or 1080p, and press **Start camera**. The page says
   **Live**, and the camera's card in Rhema says **Sending**.
4. **In a scene:** on the camera's card, **Use in a scene…** puts the camera into a scene: into an
   empty camera place if the scene has one, or as a full-frame camera underneath the other layers.
   A scene that is on air is not changed; take it off first. You can also choose the camera by name
   in a camera layer in Production → Scenes, or in Present's New / Edit scene panel.
5. **In OBS:** add a **Media Source**, untick "Local File" and paste the camera's RTSP address
   (`rtsp://<this computer>:8554/pulpit`).

Keep each phone charging, with the camera page open in front (the page keeps the screen awake).
Turn the phone sideways for a wide picture. If the phone or Wi-Fi drops, the page reconnects by
itself; the scene shows its background (or your "camera not playing" words) meanwhile.

## The Rhema Camera app (Android)

Rhema's own camera app gives a better picture than the camera page: the best size the phone encodes
(4K and HEVC where it can), a film shutter, kelvin white balance and a **look** made on the phone's
graphics chip (Studio, Cinematic, Warm Sanctuary, Natural, Black & White). See
[android-camera/README.md](../../android-camera/README.md).

1. Turn on **Secure page for phones (https)** (Settings → Remote control) at least once: the camera
   router uses the same certificate for encrypted RTSP (RTSPS, port 8322). If the router was already
   on, turn it off and on.
2. On the camera's card, **Rhema Camera app (Android)** shows a QR code and a link
   `rhema-camera://pair?host=…&port=8322&name=…&user=cam-…&token=…&fp=…`. Scan it with the phone's
   camera or Google Lens and open it in Rhema Camera (or paste the link in the app's Settings →
   Connection), and confirm **Pair**.
3. The app sends to its own name only, signed in as that camera with the same secret as its camera
   page link, and accepts only the certificate whose fingerprint (`fp`) is in the link: a computer
   pretending to be Rhema is refused, and the app never falls back to unencrypted RTSP. **New link**
   and removing the camera disconnect it, as for the camera page. Rhema renews its certificate when the
   computer's address changes or after a year: scan the new link then.

## Other camera apps

A free camera app (Moblin on iPhone, StreamCaster on Android) or a hardware encoder can send
instead of the camera page. Open "Using a camera app instead" on the camera's card for the RTMP
and SRT addresses. They carry that camera's own password (the same secret as its link): give them
only to the person running that camera. Send H.264 video without B-frames so screens and TVs can
play it.

## Ports and security

| Port | What | Who uses it |
|---|---|---|
| 8889 (TCP) | WebRTC: phones send (WHIP, through Rhema's https page), screens and TVs watch (WHEP) | Rhema, TVs, the camera page |
| 8189 (UDP) | The camera video itself (WebRTC) | Phones, Rhema, TVs |
| 8554 (TCP) | RTSP | OBS |
| 8322 (TCP) | RTSPS (RTSP over TLS, Rhema's https certificate), once secure phone pages have been on | The Rhema Camera app |
| 1935 (TCP), 8890 (UDP) | RTMP, SRT | Camera apps and encoders |
| 9997 (TCP) | The router's control API (status, disconnecting a camera) | Rhema only: this computer, a password made afresh each run, no web page |

- **Each camera sends as itself, to its own name only.** Its password is the secret in its link
  (made by Rhema, kept with the camera in Rhema's settings): the pulpit camera's link cannot send as
  the choir. The camera page goes through Rhema, which checks the secret and signs in for it.
  **New link** on a card makes a new secret, and **removing** a camera deletes it: the old QR code,
  link and app addresses stop working at once, and a phone or app still sending with them is
  disconnected.
- **The router's control API answers only Rhema:** from this computer, with a user and password
  Rhema makes afresh each time it starts the router (kept in memory and handed to the router as it
  starts; never written to a file or the log), and to no web page (no browser origin is allowed). Nothing else on the computer or
  the network can change the router's settings through it.
- **Watching is open on the church network** for now: any device on the Wi-Fi that knows a camera's
  name can watch it (as with most local cameras). Keep cameras on the church's private network,
  not a guest network open to visitors. Per-camera watch passwords are a later step.
- The router's settings file is rewritten each time it starts
  (`<Rhema's data folder>/camera-router/mediamtx.yml`, readable only by this user). The router's
  messages are in Rhema's log.
- macOS or Windows may ask whether "mediamtx" may accept incoming connections: allow it on
  private networks.
- Give the Rhema computer a fixed address on the church network (a DHCP reservation), so the
  addresses in scenes and in OBS stay the same from week to week.

## When something is wrong

- **"Camera router not installed":** this copy of Rhema was built without it (developer builds).
  Installers include it.
- **"Port 8889 is already in use":** another camera router (or a MediaMTX you started yourself) is
  running on this computer. Close it, then **Turn on** again.
- **The phone says the link is no longer valid:** the camera was removed or given a new link; scan
  the QR code again.
- **The phone is Live but the scene shows the background:** check the scene uses this computer's
  current address (the WHEP address on the card), and that the TV or screen is on the same network.

## For developers and release builds

`scripts/fetch-mediamtx.sh <target>` downloads the pinned MediaMTX release, checks its SHA-256 and
places it at `src-tauri/binaries/mediamtx-<target>` (not committed). A release build adds it with
`--config src-tauri/tauri.camera-router.conf.json` (the release workflow does both). Ordinary
`tauri dev`/CI builds do not need it: Tauri's build refuses a missing `externalBin`, so it is not in
`tauri.conf.json`. At run time Rhema looks for the router beside its own program, then in
`~/.local/mediamtx/mediamtx` (a developer's copy), else shows "Camera router not installed".
