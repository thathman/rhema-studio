# Remote control pairing and revocation (OP-006) — design

Status: built in PR #77 (pairing, tokens as hashes, revoke list, `remote:paired` / `remote:pair_closed` events). Not yet built: roles per device, `/status` reporting `paired`, QR pairing. Builds on the shared key (PR #66, #69) and the this-computer-only bind (PR #58). Goal: a volunteer pairs a phone or Stream Deck once, the operator can see and revoke devices, and nothing needs the internet.

## Today

One shared key for every device (Settings → Remote). Losing one phone means changing the key everywhere.

## Proposed

1. **Pair**: Settings → Remote → "Pair a device" shows a six-digit code for two minutes. The device sends `POST /api/v1/pair {"code":"123456","name":"Tolu's phone"}` and receives a random 32-byte token (hex) once. The code is single-use; three wrong codes end the window.
2. **Use**: HTTP sends `X-Rhema-Key: <token>` (same header as today); OSC sends the token as the first string argument (same as today). The shared key keeps working as one more "device" named "Shared key", so nothing breaks.
3. **See and revoke**: Settings → Remote lists devices (name, paired on, last seen); Revoke deletes the token at once. Tokens are stored as SHA-256 hashes in the app's settings store, never shown again.
4. **Roles (later)**: each device gets `present` (default: next/prev/show/hide/send_to_live/verse/macro) or `configure` (adds theme/opacity/confidence/on_air). The dispatcher already types every command, so a role is a set of allowed variants.

## Changes by layer

- `rhema-api`: `HttpConfig.secret: Option<String>` becomes `keys: Arc<RwLock<Vec<KeyEntry{hash, name, role}>>>` shared with the app so revocation is immediate without restarting the listener; `same_key` compares hashes; `/pair` route behind the pairing window; `/status` reports `paired: true/false` for the caller.
- Tauri: `remote_pair_start() -> code`, `remote_list_devices()`, `remote_revoke(id)`; settings persist `remoteDevices` (hashes only).
- Frontend: Settings → Remote device list; "Pair a device" dialog with the code and the laptop's LAN addresses.
- Service log: remote lines carry the device name ("remote (Tolu's phone) next").

## Threats handled

| Threat | Handling |
|---|---|
| Token sniffed on the LAN (no TLS) | Same as the shared key today; revoke the one device. TLS stays out of scope (self-signed certs confuse volunteers). |
| Pairing code guessed | Six digits, two minutes, three attempts, operator sees the window on screen. |
| Lost phone | Revoke in Settings; other devices unaffected. |
| Settings store copied | Hashes only; tokens cannot be recovered. |

## Not in scope

Cloud relay, QR pairing (nice later: the dialog can show a QR of `http://<ip>:8080/pair?code=…`), per-user accounts (CL-001 roles).

## Size

About a day: api crate (~150 lines + tests), Tauri (~80), Settings UI (~150). Acceptance rows: pair, use, revoke, wrong code, restart persistence.
