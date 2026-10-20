# Sync transport evaluation and threat model (CL-004)

Status: **proposal for an owner decision**. Nothing here is built, bought or configured. It answers PRD FR-08: how a service prepared at home reaches the church laptop, with no cloud required to present and no lock-in.

## What already exists (verified in code)

- **Service file** (CL-003, PR #56): one service with its songs and pictures, SHA-256 checked, opened on another computer with no network. This is the zero-infrastructure baseline and stays supported whatever is chosen below.
- **Approval** (CL-002, PR #59): the approved revision is pinned and never pruned; Home warns when the service changed since.
- **Database backup/restore**, **service logs**, **operator name on audit rows**. All local.

## Options

| | A. Files only (today) | B. Shared folder sync | C. Self-hosted relay | D. Hosted relay (vendor) |
|---|---|---|---|---|
| How | Carry/email the service file | A folder synced by something the church already has (Google Drive, OneDrive, Syncthing); Rhema writes/reads service files there | A small HTTPS service the church runs (e.g. on a cheap VPS or the office PC) storing service files per church, with per-device tokens | The same relay, run by a vendor, paid per church |
| Works offline to present | Yes | Yes (files are local once synced) | Yes (files cached locally) | Yes (files cached locally) |
| New code in Rhema | None | "Watch this folder": import new service files, mark the newest as "ready to open"; conflict = two files, both kept | Client: upload/download service files, device pairing (token), activity list. Server: ~300 lines (Go/Rust), SQLite, TLS | Same client; vendor runs the server |
| Conflicts | Human | Two files with the same title: both listed, newest first; never auto-replace an open or approved service | Server keeps every upload as a version; client shows "newer version available", never auto-activates (FR-08) | Same |
| Security | Physical | The sync product's account security; files are plain JSON (song words, pictures). Encrypt-at-rest optional later (age/passphrase) | TLS; per-device token; revocation = delete token; data stays with the church | TLS; vendor holds the data → privacy policy, retention, jurisdiction questions |
| Recurring cost | 0 | 0 (already paid for) | ~$5–10/month VPS, or 0 on the office PC; someone must keep it updated | Vendor fee; recurring cost needs owner approval (mandate) |
| Lock-in | None | None (files) | None (files + open server) | Files remain portable; the relay is replaceable |
| Fit for a volunteer | Best | Good ("save to the church folder") | Good once paired | Good once paired |

## Threat model (B and C)

| Threat | B. Shared folder | C. Self-hosted relay |
|---|---|---|
| Someone with the folder account reads song words/pictures | Accept (same people who can edit songs); optional passphrase encryption of service files later | Only paired devices; tokens revocable |
| A tampered or damaged file | Checksum refuses it (already) | Same, plus server-side hash |
| Wrong version goes live | Never auto-opened; approval chip shows "changed since approval"; operator chooses | Same |
| Relay compromised | n/a | Attacker can read/replace service files; cannot touch the live output (the laptop opens files by choice); TLS + tokens + the checksum limit tampering to "a different valid file", which the approval flow catches |
| Loss of the server | n/a | Files are also local on every device; rebuild from any laptop |

## Recommendation

1. **Ship B first** (next slice, small): a "church folder" setting; Library lists service files found there; Prepare offers "Open the newest file for Sunday"; saving a service also drops its file there. Zero cost, no accounts, and it covers the actual need (prepare at home, present at church).
2. **Design C only if two or more churches or a remote editor without folder access appear.** Keep it a thin file relay, never a content model of its own, so A and B stay valid.
3. **Do not pursue D** until there is a reason the church cannot self-host; it is the only option with a recurring vendor cost and a data-custody question (needs owner approval either way).

## Owner decision needed

- Approve B as the next slice (no cost), or ask for C's design first.
- Whether service files in a shared folder should be passphrase-encrypted (adds a step for volunteers; protects words/pictures from the folder's other users).
