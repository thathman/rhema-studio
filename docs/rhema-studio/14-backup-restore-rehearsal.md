# Backup and restore rehearsal (QA-010)

A drill to run once before the first public release and after any change to the content database, on the production laptop and a standby laptop. Every row is a manual desktop test: mark it in the acceptance guide when performed. Nothing here has been performed yet.

## What "last good" means

- **Approved service**: Prepare → Approve pins the saved version; History shows it as "approved" and it is never pruned (CL-002).
- **Service file**: More → Library → "Save this service as a file" carries that service with its songs and pictures (CL-003).
- **Database backup**: More → Library → "Back up now" copies everything (services, songs, history, media index; not the picture files themselves, which live in the media folder).

## Drill

| # | Step | Expected | Result |
|---|---|---|---|
| R1 | On the production laptop: approve Sunday's service, save it as a file, back up the database. Copy both files and the media folder to a USB stick. | Three artefacts on the stick; the app keeps running. | Unverified |
| R2 | On the standby laptop (fresh install): Library → "Open a service file…" from the stick. | The service opens in Prepare with every item, song and picture; Home readiness shows no missing songs or pictures. | Unverified |
| R3 | Still on standby: Library → "Restore from a backup…" with the stick's database, then copy the media folder in. | All services and songs appear; the previous standby database is kept as a snapshot next to it. | Unverified |
| R4 | Back on production: make a wrong edit, save, then History → restore the approved version. | The approved items are back; the wrong version remains in History as a newer entry. | Unverified |
| R5 | Pull the USB during R2 or R3. | The app reports the failure and nothing half-written appears (the checksum or restore verification refuses it). | Unverified |

Time the drill; the target is under ten minutes from "laptop died" to "standby on screen with the approved service".
