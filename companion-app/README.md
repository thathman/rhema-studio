# Rhema Studio Companion

A small app for a second computer that runs **OBS only**. It finds the church's Rhema on the
network, pairs with it, lists the church's phone cameras, and adds the ones you pick to this
computer's OBS as Media Sources. OBS then cuts between them on its own; the screens in church are
never changed from here. Rhema shows, in Production → Cameras, which cameras this OBS has on
program and preview.

Version 1.0.0.0 (the build tools take three parts, so files say 1.0.0).

## App or mode?

| | Rhema Studio Companion (this app) | OBS companion mode in Rhema |
|---|---|---|
| Install | Only this small app (a 4 MB Windows installer; the app is about 10 MB) | The whole Rhema app with its speech and Bible models |
| Talks to the host | Only over the host's secure page, with the host's certificate shown before pairing and pinned after | Over the host's plain http page |
| Runs | In the menu bar / notification area; can start with the computer | In Rhema's window |
| Use it when | The OBS computer is a separate machine you set up once | The computer sometimes runs Rhema's full studio too |

Both show the same screen and do the same work in OBS.

## What it needs from the host

On the main Rhema computer:

1. Settings → Remote control: **Accept commands from other devices on this network**, and
   **Secure page for phones (https)** on, then start (or stop and start) the HTTP listener. The
   companion uses the next port after it (8081 for 8080) and refuses to pair without it.
2. Production → Cameras: the camera router on, with the cameras added.
3. Settings → Remote control → **Pair a device** when the companion asks for the code. The host's
   certificate is shown next to "Secure page for phones" there: the companion shows the same four-
   character groups before you press Join. If they differ, do not join.
4. After pairing, set the companion's role to **OBS companion** if the host has not.

On this computer: **OBS 30 or newer** with Tools → WebSocket Server Settings → Enable WebSocket
server (port 4455 and its password go into the companion's OBS card).

## What it keeps, and where

Everything is its own, never the studio app's (identifier `com.openbezal.rhema.companion`):

- Windows: `%APPDATA%\com.openbezal.rhema.companion\` — `settings.json` (OBS address, host
  address, delay buffer) and `companion.json` (the paired host and its certificate fingerprint).
- macOS: `~/Library/Application Support/com.openbezal.rhema.companion/`.
- The pairing key and the OBS password go in the system's credential store under
  "Rhema Studio Companion" (Windows Credential Manager, macOS Keychain); the settings file keeps them only
  where there is no credential store.
- Its log: `%LOCALAPPDATA%\com.openbezal.rhema.companion\logs\` (Windows),
  `~/Library/Logs/com.openbezal.rhema.companion/` (macOS).

Closing the window keeps the app running in the notification area (Windows, by the clock) or the
menu bar (macOS), so OBS's camera addresses stay current. Its icon's menu has **Open**, **Start
with the computer** (off until you tick it; it then starts in the tray and joins its host by
itself) and **Quit**. A second launch only brings the window forward.

## Build and run on Windows (the main target)

Prerequisites, once:

1. **Git** for Windows.
2. **Bun** (the repo's package manager: `powershell -c "irm bun.sh/install.ps1 | iex"`). Node 22
   works for running scripts, but install the dependencies with Bun (`bun.lock`).
3. **Rust** stable with the MSVC toolchain (`rustup default stable-x86_64-pc-windows-msvc`), and
   **Visual Studio Build Tools** with the **Desktop development with C++** workload (the linker
   and the Windows SDK). No OpenSSL is needed: https uses rustls with ring.
4. **WebView2** runtime: already on Windows 10 (current) and 11. The installer fetches it if it is
   missing.

Build from a fresh clone (no `models/` or `data/rhema.db` needed):

```powershell
git clone https://github.com/thathman/rhema-studio.git
cd rhema-studio
git checkout comp-051/companion-app   # until it is merged
bun install
bun run companion:build
```

The results:

- `companion-app\src-tauri\target\release\Rhema Studio Companion.exe` — runs as it is.
- `companion-app\src-tauri\target\release\bundle\nsis\Rhema Studio Companion_1.0.0_x64-setup.exe` — the
  installer (per-user, no administrator needed).

First build on the Windows workstation (2026-10-24): about 6 minutes; `Rhema Studio Companion.exe` 10.3 MB,
the installer 4.0 MB. The Mac `.app` (Intel) is 8.2 MB.

While working on it: `bun run companion:dev` (a window with live reload; the page is served on port
3001, so it runs beside the studio's dev server).

The first start asks the **Windows Defender Firewall** whether Rhema Studio Companion may use networks:
allow **Private networks**. It needs that to find hosts (mDNS, UDP 5353) and to read the cameras
(SRT from the host's camera router). It listens on no port of its own. OBS's own firewall prompt is
separate.

## Build and run on macOS

Xcode Command Line Tools, Rust stable and Bun, then `bun install` and `bun run companion:build`.
The app is `companion-app/src-tauri/target/release/bundle/macos/Rhema Studio Companion.app` (ad-hoc
signed; the first open needs right-click → Open). On an Intel Mac building for Intel:
`bun run companion:build -- --target x86_64-apple-darwin`.

## Tests

- `bun run companion:test` — the companion's window (vitest).
- `cd src-tauri && cargo test -p rhema-join --features pinned,keychain` — the shared crate:
  finding hosts, pairing, following, and the certificate pinning against the host's real
  certificates.
- `cd companion-app/src-tauri && cargo test` — the companion's own commands (it needs
  `companion-app/build` to exist: run `bun run companion:web` once, or create the folder).

## How it is put together

- `companion.html` and `src/companion-main.tsx`: the page. It reuses the studio's modules through
  the `@/` alias (the companion screen, the OBS connection, the join store, the settings store, the
  design tokens and UI components); nothing is copied.
- `companion-app/vite.config.ts`: builds that page alone into `companion-app/build`.
- `companion-app/src-tauri`: the Rust app. Host discovery, pairing and following come from the
  shared crate `src-tauri/crates/join` (`rhema-join`), which Rhema itself uses too; this app adds
  the pinned https link, its own files, the tray and starting with the computer. No NDI, speech,
  models, Bible, content database or camera router.
- `companion-app/src-tauri/icons`: the owner's approved Rhema Studio icon from the brand pack
  (`04_Launcher_Assets`): `icon.ico`, `icon.icns` and `512x512.png` (Companion-Launcher-512) byte for
  byte; the 32, 128 and 256 pixel PNGs are scaled down from that 512 PNG, never redrawn.
