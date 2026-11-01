# Hardware acceptance checklist

To run on real devices. Nothing here has been run yet, so hardware compatibility is **not verified**. Record the date, device, OS, Rhema build and result for each line. A line passes only if it was seen on that device.

## Before starting

- Use a rehearsal with a supervisor present, never a real service.
- Merge the stabilization PRs first, and record the `main` commit under test.
- Keep OBS available as the fallback recorder until sections 1 to 3 pass.

## 1. Recording: every computer

Run on the Intel Mac, an Apple Silicon Mac and a Windows PC.

- [ ] Record 30 minutes of the congregation output with moving content. The file plays in QuickTime or Windows Media Player and VLC, with picture and sound in sync at start and end.
- [ ] Recording history shows the right duration. Frames dropped is 0, or the count is written down.
- [ ] The display stays on and the computer stays awake with its sleep timer set to 2 minutes.
- [ ] Quit from the app menu while recording. The file is Saved and plays. *(#559: never run in the app.)*
- [ ] Force-quit while recording. On next launch the file shows Recoverable and plays up to the crash.
- [ ] Unplug the power for 5 minutes on a laptop. Recording continues without dropped frames.
- [ ] Fill the disk until under 1 GB is free. The low-disk warning shows, then the recording closes and the file plays.
- [ ] Non-English characters in the recordings folder path work (Windows especially).
- [ ] Note CPU load with Live, recording and one camera running. Does the busy-computer warning appear, and is it correct? *(The threshold comes from one bad run on the Intel Mac.)*

## 2. Sound: physical mixer

- [ ] The mixer's USB or interface input appears by name and its meter moves.
- [ ] Record at 44.1 kHz and at 48 kHz. Both play at the right pitch.
- [ ] Set the interface to 96 kHz. Start is refused with a clear message and Live keeps running. *(#559: the macOS refusal has an encoder test but was never run through the app; Windows code limits rates, never tried on a device.)*
- [ ] Unplug the mixer while recording. The warning appears and the picture keeps recording.
- [ ] Record for 60 minutes, then measure sync at the end. Drift must stay within the 50 ms limit in the design.
- [ ] Confirm only the approved church input is recorded, with no computer sounds or Talk audio.

## 3. Outputs and TVs

- [ ] The recording shows the same picture as the selected congregation screen, including a designed moment and a scene change.
- [ ] Stage output content never appears in the recording.
- [ ] Rhema Receiver on a Google TV: pair, show verse, scene and design, and check overscan.
- [ ] Turn off Wi-Fi to the TV for 1 minute and restore it. The TV recovers without operator action.
- [ ] A projector or HDMI display on a second output keeps the correct resolution after sleep and replug.

## 4. Cameras

- [ ] Rhema Cam on a phone: appears in Production, plays in a scene, and shows the right state when it stops sending.
- [ ] Measure delay from real movement to the output.
- [ ] Battery and heat warnings appear on a real phone.

## 5. OBS and NDI

- [ ] Rhema still works with OBS closed, and recording does not need OBS.
- [ ] OBS receives the NDI output at the expected frame rate, measured with a receiver.
- [ ] Start NDI at another size during a recording. It is refused and the recording's picture keeps moving. *(#559: never run in the app.)*
- [ ] Start NDI first, then record at the same size. The file is correct.
- [ ] Record in OBS and in Rhema together for 30 minutes. Both files are clean and the computer copes.

## 6. Windows only

- [ ] Installer build, install and first launch. *(Windows installer builds are paused; this needs the owner's go-ahead.)*
- [ ] The recording path above works in the installed app, not only in `recorder-windows.yml`.
- [ ] Firewall prompt and joined desks over the LAN.

## 7. Joined desks over a real network

- [ ] Two desks and a phone on Wi-Fi follow the service for 30 minutes.
- [ ] A View only phone shows Now, Next and the clock, and shows no outputs, scenes or cameras.
- [ ] Approve a desk's scene request end to end, once the Permissions apply action exists.
- [ ] Restart the host with a request pending. An approved request is refused as stale.

## 8. Supervised rehearsal: full run

Build a plan in Prepare, pin a design, start recording, then Take through the whole service: verse, song, designed moment, manual scene change, Clear, rehearsal in and out, and a desk request. Stop the recording and watch the file from start to end.

- [ ] No screen showed something Live did not claim.
- [ ] The recording matches what the congregation saw.
- [ ] The operator was never left guessing what state the system was in.

## Failure cases that need no hardware

Automated tests exist for: crash fragments, late first picture, still screen, silent recording, encoder backlog, audio drift, forged output role, unsupported sound rate on macOS, manifest write failure, second start, lost sound with lost picture, Viewer data filter, approval revision across restarts.

Still without a test: frame size change, tee routing by output, disk thresholds (need injectable free space), quit while recording, sound refused by the writer, Stop with zero frames, dock remount during recording, Windows writer failure before `Finalize`.
