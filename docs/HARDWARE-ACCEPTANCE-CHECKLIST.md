# Hardware acceptance procedures

**Nothing here has been run on real devices, so hardware compatibility is not verified.** A line passes only if a person saw it happen on that device. Automated tests and the scripted native journeys are not hardware evidence.

For each run, write down the date, device, OS, `main` commit, tester and the result of each line. Tick a box only for what you saw.

## Rules for every session

- Use a rehearsal with a supervisor present, never a real service.
- **OBS fallback:** until sections 1 to 3 pass, keep OBS recording the same picture and sound on the same computer. Start OBS first.
- If a step fails: note the time and the message on screen, keep the file, leave the app open, and copy the log from Settings → Diagnostics. Do not retry until this is written down.
- **If Rhema fails during a rehearsal:** keep going on OBS. Do not restart Rhema while its recording says Finalizing. If a screen shows the wrong thing, press Clear; if it stays wrong, turn that output off.
- Real-service readiness needs every section below to pass on the computers the church will use.

## 1. Recording: Intel Mac, Apple Silicon Mac, Windows PC

Windows needs the owner's go-ahead (section 6). Set the computer's sleep timer to 2 minutes. Use moving content on the congregation output.

| Step | Expected | Failure signal |
|---|---|---|
| Record 30 minutes, stop, play in QuickTime or Windows Media Player and in VLC | Plays start to end; picture and sound in sync at both ends | Won't open, short file, sync visibly off |
| Open Recording history | Right duration; frames dropped is 0, or write the count down | Wrong duration, unexplained drops |
| Watch the computer during the recording | Display stays on, computer stays awake | Screen sleeps, "no picture for 5 seconds" |
| Move to Prepare and Design during a recording | Status stays visible at the top; Open Live returns to it | Status disappears, or says idle |
| Quit from the app menu while recording | File is Saved and plays | Recoverable or Failed after a normal quit |
| Force-quit while recording, reopen | File shows Recoverable and plays up to the crash | Missing or unplayable |
| Laptop: unplug power for 5 minutes | Recording continues, no dropped frames | Drops or stop |
| Fill the disk to under 1 GB free | Warning shows, then the recording closes and plays | No warning, unplayable file |
| Recordings folder with non-English characters in its path | Saved, listed and plays | Start refused or file not found |
| Live, recording and one camera together; note CPU load | Busy warning appears only when genuinely loaded | Warning absent under real stutter, or constant when idle |
| Recording while OBS also encodes, 30 minutes | Both files clean | "Recording stopped writing"; note the code in the message |

## 2. Sound: church mixer

| Step | Expected | Failure signal |
|---|---|---|
| Connect by USB or interface | Input appears by name, meter moves | Missing, meter still |
| Record at 44.1 kHz, then 48 kHz | Both at the right pitch | Pitch or speed wrong |
| Set the interface to 96 kHz, press Start | Refused with a clear message; Live keeps running | App crash, or Live interrupted |
| Unplug the mixer while recording | Warning appears; picture keeps recording | No warning, or picture stops |
| Record 60 minutes with a clap at start and end | Sync within 50 ms at the end (measure in an editor) | Drift over 50 ms |
| Play computer sounds and use Talk during a recording | Only the church input is in the file | Other sound is audible |

## 3. HDMI, projectors and TVs

| Step | Expected | Failure signal |
|---|---|---|
| Record a designed moment and a scene change | File matches the congregation screen | Different picture |
| Show different content on a stage output | Never in the recording | Stage content appears |
| Projector or HDMI display: sleep it and replug | Keeps the right resolution, correct picture returns | Wrong size, blank, or wrong screen |
| Rhema Receiver on Google TV: pair; show a verse, a scene and a design | All display; overscan can be set | Refused pairing, clipped edges |
| Turn off the TV's Wi-Fi for 1 minute, restore | Recovers with no operator action | Stuck, or needs pairing again |

**Fallback:** an HDMI output from the Mac to the main display.

## 4. Phone cameras

| Step | Expected | Failure signal |
|---|---|---|
| Rhema Cam: appears in Production, plays in a scene | Live picture | Absent or black |
| Stop sending from the phone | Scene shows the right state, not a frozen frame | Frozen picture looks live |
| Measure movement to output delay | Write the number down | No limit yet: the owner decides what is acceptable |
| Use on a real phone until warm, on low battery | Heat and battery warnings appear | No warning |

**Fallback:** remove the camera from the scene with its fallback words, or use the OBS camera.

## 5. OBS and NDI

| Step | Expected | Failure signal |
|---|---|---|
| Close OBS and run Live and recording | All work | Anything needs OBS |
| OBS receives NDI; measure with a receiver | Expected frame rate | Below rate, stalls |
| Start NDI at another size while recording | Refused; the recording's picture keeps moving | Picture freezes or file fails |
| Start NDI first, then record at the same size | File is correct | Wrong size or stretched |

## 6. Windows only: paused until the owner authorizes installer builds

- [ ] Installer build, install and first launch.
- [ ] Section 1 in the installed app, not only `recorder-windows.yml`.
- [ ] Firewall prompt appears, and joined desks work over the LAN.

## 7. Joined desks over real Wi-Fi

| Step | Expected | Failure signal |
|---|---|---|
| Two desks and a phone follow the service for 30 minutes | All stay current; connection state is honest | Silent staleness |
| View only phone | Now, Next and clock only; no outputs, scenes or cameras | Any production data |
| Change a desk's role or revoke it during a service | Desk reconnects with its new rights, or is refused and cleared | Old data or controls remain |
| Turn the router off for 1 minute | Desks say reconnecting, then recover; host's screens unaffected | Host stalls |
| Desk scene request: approve and apply | Applied once, journal names the requester | Applied twice, or no record |
| Restart the host with an approved request waiting | Refused as stale | Applied |

**Fallback:** run from the main desk alone. A joined desk never holds up the screens.

## 8. Supervised rehearsal: full run

Build a plan in Prepare, pin a design, approve it in Permissions, start recording, then Take through the whole service: verse, song, designed moment, manual scene change, timed move, Clear, rehearsal in and out, and a desk request. Then force-quit, reopen and Put back. Stop the recording and watch the file from start to end.

- [ ] No screen showed something Live did not claim.
- [ ] The recording matches what the congregation saw.
- [ ] The operator was never left guessing what state the system was in.
- [ ] Put back restored the screens, or said clearly what it could not restore.

## What automated tests already cover

No device needed: crash fragments, late first picture, still screen, silent recording, encoder backlog, timeline holes against late pictures, audio drift, forged output role, unsupported sound rate on macOS, manifest write failure, second start, lost sound with lost picture, Viewer data filter, approval revision across restarts, approval changes during rehearsal.

Still without an automated test: frame size change through the real app, tee routing by output, disk thresholds (need injectable free space), quit while recording, sound refused by the writer, Stop with zero frames, Windows writer failure before `Finalize`.
