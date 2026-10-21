# Known issues and limits

Kept for every release candidate (release gate RG-10). "Unverified" means the behaviour is implemented and tested in code but has not been checked on a real computer, projector or OBS setup yet.

## Not yet verified on real hardware
- Every row of `docs/rhema-studio/08-desktop-acceptance-guide.md` (sections 1–10ah), the Windows installer launch (#32) and the backup drill (#62).
- **Video over NDI from a hidden window:** WebView2/WebKit may throttle timers in a hidden window to about one per second, so an NDI-only output could send video at roughly 1 fps. Visible display outputs are unaffected. Row 10ab.4.

## Limits by design (for now)
- Only one copy of Rhema runs per computer user; launching it again brings the running one forward. Closing the main window quits Rhema, outputs included. On macOS, Quit from the menu (Cmd+Q) may not ask about unsaved service changes; closing the window does (unverified, row 10aq).
- NDI carries pictures, not sound. Video sound plays from the main output only.
- A service file includes its pictures and videos; large videos make it large.
- The OBS WebSocket password and the remote-control key are stored in the local settings file in clear; use a staff-only network (`docs/rhema-studio/13-remote-control-threat-notes.md`).
- Remote control has no TLS; a paired device's token travels in clear on the LAN.
- Record chapters in OBS need OBS 30.2+ recording to Hybrid MP4; older OBS gets the mark in the service log only.
- The program preview shows "▶ name" for videos and the words (not the code) for QR slides; outputs show the real thing.

## Owner decisions still open
- Sync approach (#72), Canva relay (#34), speech provider and bundling (PR #4), app identity for release (ST-009), whether approval must gate going live, which giving/prayer systems to link.

## Code health
- 7 ESLint errors remain in upstream components this fork has not changed (React hook patterns); CI reports them, the blocking subset is clean.
