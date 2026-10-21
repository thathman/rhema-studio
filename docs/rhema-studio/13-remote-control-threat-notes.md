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
- The OBS WebSocket password, like the remote key and API keys, is kept in the system keychain (Windows Credential Manager, macOS Keychain, Linux Secret Service; one entry holding all of them), written and read back before the settings file's copy is blanked; a keychain that cannot be read within 5 seconds is left untouched for that session; without a keychain it stays in the settings file in clear; the protocol never sends it (SHA-256 challenge). Over plain `ws://` the login answer can still be captured and the password attacked offline by anyone on that network, so keep OBS and Rhema on a staff-only network. Settings are applied with an explicit Save, never per keystroke (a per-keystroke reconnect would leak the password one prefix at a time).
- Starting or stopping a recording is an explicit two-step action in Present; no macro or remote command does it.

## Diagnostics export (RG-08)

Settings → Diagnostics → Save logs runs every line through a redaction pass first: the exact values of the configured API keys, remote key and OBS password (read from the keychain and the settings file; read from the settings file, 6+ characters) and anything after `X-Rhema-Key:`, `Authorization: Bearer `, `api_key=` or `token=` become `[redacted]`. The app does not log these; this is defence in depth for a file meant to be sent to someone else.

## Rate limiting (NFR-06)

- Every HTTP request to `/api/v1/command` and `/api/v1/pair`, and every OSC command that passed the key check, is counted per sender address (`crates/api/src/rate.rs`): a burst of 20, then 10 a second sustained. Beyond that HTTP answers 429 and OSC drops the packet; both log a warning. Buttons, Stream Deck pages and macros stay far below it; a stuck controller or a flood cannot hammer the live output, and pairing codes cannot be guessed quickly.
- At most 256 senders are remembered (least recently seen dropped first), so spoofed UDP source addresses cannot grow memory. OSC counts a message only after its key is accepted, so packets spoofed from a Stream Deck's address without the key cannot use up its allowance. OSC fader values (confidence, opacity) are not counted: a fader sends dozens a second and the last value must land.

## Phone remote and QR pairing

- `GET /remote` serves one static page (no key needed to load it; every command it sends is checked like any other). Settings → Remote → Pair a device shows a QR code for `http://<this computer>:<port>/remote#code=<six digits>` when other devices may connect. The code is in the fragment, so it never reaches a server or its logs, and the page removes it from the address bar at once.
- The page pairs with `/api/v1/pair` and keeps the device token in the phone browser's local storage; it sends Next, Previous, Back on air (show) and Clear (hide) with `Authorization: Bearer`. A revoked token gets 401 and the page returns to pairing. "Unpair this phone" forgets the token on the phone only; revoke it in Settings too.
- The page has a strict content security policy (no outside scripts or connections, no framing). Plain HTTP on the LAN: someone on the same network who can watch traffic can copy the token, as with the shared key.
- The status line polls `/api/v1/status`, which was already open; it shows the live reference text.

## Not done

- TLS. (Roles per device: #78. Rate limiting and the phone remote: see above.) (Every remote command is now a "remote command" line in the service log, More → Library → Save the log.)
