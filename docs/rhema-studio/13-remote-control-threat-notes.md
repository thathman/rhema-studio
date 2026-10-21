# Remote control (OSC and HTTP): threat notes

QA-006 first slice. What the two control surfaces expose today, verified from the code, and what guards them.

## Facts (verified in code)

- Both listeners are **off until the operator starts them** in Settings → Remote, every session (ports are not persisted). Rust: `commands/remote.rs`.
- **OSC** listens on UDP (default 8000), **HTTP** on TCP (default 8080). Default bind is every interface (`0.0.0.0`); the Settings checkbox "Accept commands from other devices on this network" unticked binds `127.0.0.1` instead (this PR).
- **Paired devices** (Settings → Remote → Pair a device): a six-digit code for two minutes, three tries; the device `POST`s `/api/v1/pair {code, name}` and gets a 256-bit token once; Settings lists devices and revokes them at once (both listeners share the key set, so no restart). Tokens are stored as SHA-256 hashes. Each device has a role: **Present only** (next/prev/show/hide/send_to_live/verse/bible/add_to_queue/macro; the default for a newly paired device) or **Present and change settings** (adds theme, opacity, confidence, on_air; the shared key's role). Refused commands answer 403 on HTTP and are dropped and logged on OSC.
- **Optional shared key** (Settings → Remote), kept as one more entry named "Shared key".
- **"Require a key or a paired device"** is its own switch, forced on while any key exists and kept on after the last one is removed, so revoking the last phone denies everything instead of reopening the surface; the operator unticks it deliberately to go back to open. When set, HTTP `/api/v1/command` requires `X-Rhema-Key: <key>` or `Authorization: Bearer <key>` (401 otherwise; `/health` and `/status` stay open) and every OSC message must start with the key as a string argument (refused and logged otherwise). Blank key = nothing authenticates, as shipped. The key travels in clear on the LAN (no TLS), so it stops accidents and casual misuse, not a determined attacker on the same network.
- **Command surface** (`crates/api/src/command.rs`, 15 variants): next/prev, show/hide/on_air, send_to_live, bible_next/prev, verse_next/prev, add_to_queue, theme, opacity, confidence, macro. Every one goes through the same frontend actions as the buttons, so the live-safety rules hold (nothing goes on air before it has loaded; a bad reference is a warning). Payloads are typed and bounded (`coerce.rs`), unknown addresses and bad arguments are rejected with an error, and HTTP bodies are size-limited by the server.
- Nothing on these surfaces reads or writes files, settings, the database or the network; the worst a sender can do is change what is on screen or turn the output off.

## Threat model

| Who | Can | Mitigation today | Later |
|---|---|---|---|
| Anyone on the church Wi-Fi while a listener runs on `0.0.0.0` | Put any verse, song slide, theme or blank on the screen; turn the output off | Start listeners only when needed; untick the network box when the controller is on this computer (Companion, Stream Deck software); keep the production laptop on a staff VLAN or wired network | Shared secret (OSC argument / HTTP header), per-device pairing (OP-006) |
| A stray UDP packet / scanner | Trigger a command by guessing the address | Addresses are specific (`/rhema/...`); bad arguments rejected | Same as above |
| Malformed input | Crash the listener | Parsers are bounded and tested (`rhema-api` 108 tests); a listener error never touches the live output | — |

## Operator guidance (also in PRODUCTION-GUIDE)

1. Start the listener you use, right before the service, and stop it after.
2. If the controller software runs on the same laptop, untick "Accept commands from other devices on this network".
3. Use a wired or staff-only network for the production laptop; never the guest Wi-Fi.
4. Until pairing exists, treat anyone on that network as able to press Next.

## OBS connection (AR-002)

- Outbound only: Rhema connects to OBS's obs-websocket server; it opens no port. The CSP `connect-src` allows `ws:` so OBS can be on the streaming PC, not only this one (an injected script could therefore open a WebSocket anywhere; the app loads no remote content, so this is defence in depth only).
- The OBS WebSocket password is stored in the local settings file in clear, like the remote key; the protocol never sends it (SHA-256 challenge). Over plain `ws://` the login answer can still be captured and the password attacked offline by anyone on that network, so keep OBS and Rhema on a staff-only network. Settings are applied with an explicit Save, never per keystroke (a per-keystroke reconnect would leak the password one prefix at a time).
- Starting or stopping a recording is an explicit two-step action in Present; no macro or remote command does it.

## Diagnostics export (RG-08)

Settings → Diagnostics → Save logs runs every line through a redaction pass first: the exact values of the configured API keys, remote key and OBS password (read from the settings file, 6+ characters) and anything after `X-Rhema-Key:`, `Authorization: Bearer `, `api_key=` or `token=` become `[redacted]`. The app does not log these; this is defence in depth for a file meant to be sent to someone else.

## Not done

- Roles per device (present vs configure), rate limiting, TLS, QR pairing. (Every remote command is now a "remote command" line in the service log, More → Library → Save the log.)
