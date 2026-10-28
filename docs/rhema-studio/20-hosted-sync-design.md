# Optional hosted synchronization: design (CL-005, decision #72 step 2)

Status: **design for review; nothing built, hosted or paid for.** Owner decision #72 (2026-10-21): shared folder/NAS and versioned service packages first (built: #126, #127), then *optional* hosted synchronization. This is that second step, written so the owner can choose how it is hosted. It must never become required to present (PRD FR-08, NFR-09).

## What it adds over the church folder

The church folder already moves services between computers. A hosted relay adds only what a folder cannot:
1. Reach without a NAS or a sync product (a pastor's laptop at home, a phone).
2. Who published what, from which device, with revocation (folder access is all-or-nothing).
3. A "newer version" signal without scanning a folder.

It does **not** add live co-editing, a content model of its own, or anything on the render path.

## Shape: a thin file relay

The relay stores the same service package files the folder holds (`.rhema-service.json`, format 1, checksummed), per church, with versions. It never parses services beyond reading the package header; the app does everything else exactly as with the folder.

| | Relay |
|---|---|
| Storage | `churches/<church>/packages/<sha256>.json` plus a small index (title, date, source id, revision, approval, published by/at) in SQLite |
| API (HTTPS, JSON) | `POST /v1/packages` (upload; idempotent by sha256), `GET /v1/packages?since=<cursor>` (index), `GET /v1/packages/<sha256>` (download), `POST /v1/devices/pair` (6-digit code shown in the app → device token), `DELETE /v1/devices/<id>` (revoke) |
| Auth | Per-device bearer tokens (hashed at rest), created by pairing from an already-trusted device; roles: *publish* and *read*. Same model as the LAN remote (#77/#78) |
| Size | ~400 lines in Rust (axum + rusqlite, both already in the app), one binary, one SQLite file; streaming uploads up to the package cap (1 GB) |
| Client | A second "source" beside the church folder: Publish also uploads; Home's Church folder card lists relay entries too (same rows, same "newer version" logic, same explicit Open). Offline: the last list is shown; nothing waits on the network |

## Hosting options (owner choice)

| Option | Cost | Who holds the data | Effort for the church |
|---|---|---|---|
| **C1. On a computer the church already has** (office PC, always-on NAS that can run a container) | 0 | The church | Install once; keep it updated; reach from outside needs a router port or a tunnel |
| **C2. Small VPS the church rents** (any provider) | ~$5–10 / month | The church (on rented hardware) | Someone sets it up once (a script and TLS via Let's Encrypt) |
| **D. Run by a vendor/maintainer for many churches** | Per-church fee | The vendor | None; requires a privacy policy, retention and jurisdiction answers |

C1/C2 keep the "no lock-in, the files stay the church's" property of the folder. D is the only one with recurring vendor cost and data-custody obligations and needs explicit owner approval under the mandate.

## Threat model (delta over the folder)

| Threat | Mitigation |
|---|---|
| Stolen device token | Revoke it from any trusted device; tokens are per device and hashed on the server |
| Relay compromised | Attacker can read packages (song words, pictures) and upload new ones; cannot touch any live output. Uploads are signed by the device token holder only on the server side, so a compromised relay could serve a forged package: mitigated by the same rule as the folder — nothing opens by itself, approval is given again at church, and (optional) end-to-end encryption below |
| Eavesdropping | TLS only; no plain HTTP |
| Replay / rollback (old version re-served as newest) | Index entries carry revision and sha256; the app never treats a lower revision as newer (`newerInFolder` rule) |
| Data custody | C1/C2: the church's; D: vendor policy required |

**Optional end-to-end encryption** (also answers the open folder question): packages encrypted with a church passphrase (age/scrypt or XChaCha20-Poly1305 + Argon2id) before they leave the computer; the relay and the folder then hold ciphertext only. Cost: every computer needs the passphrase once; a lost passphrase means re-publishing. Off by default; a per-church setting.

## Build order once a hosting option is chosen

1. Relay binary + its own tests (pairing, upload idempotency, index cursor, revoke), packaged as one executable and a container image.
2. App: relay settings (URL + pairing), Publish uploads too, the Church folder card shows relay entries, cached list for offline.
3. Threat review update (QA-006 cloud part) and acceptance rows; then CL-007 team comments can build on the relay's index if wanted.

## Decisions needed from the owner

1. Hosting: C1, C2 or D (or C now, D later).
2. Whether to add passphrase encryption (for the folder now, and the relay later), knowing it adds a step for volunteers.
