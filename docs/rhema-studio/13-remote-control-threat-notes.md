# Remote control (OSC and HTTP): threat notes

QA-006 first slice. What the two control surfaces expose today, verified from the code, and what guards them.

## Facts (verified in code)

- Both listeners are **off until the operator starts them** in Settings → Remote, every session (ports are not persisted). Rust: `commands/remote.rs`.
- **OSC** listens on UDP (default 8000), **HTTP** on TCP (default 8080). Default bind is every interface (`0.0.0.0`); the Settings checkbox "Accept commands from other devices on this network" unticked binds `127.0.0.1` instead (this PR).
- **No authentication.** No token, password or allow-list on either surface (`crates/api/src/http.rs`, `osc.rs`).
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

## Not done

- Authentication and pairing (OP-006), rate limiting. (Every remote command is now a "remote command" line in the service log, More → Library → Save the log.)
