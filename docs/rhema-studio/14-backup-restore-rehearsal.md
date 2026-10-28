# Backup and restore rehearsal (QA-010)

A drill to run once before the first public release and after any change to the content database, on the production laptop and a standby laptop. Every row is a manual desktop test: mark it in the acceptance guide when performed. First run: 2026-10-21 on the owner's Intel Mac, with two isolated profiles standing in for the production and standby laptops and a mounted disk image as the USB stick (results below; the native file pickers were not used: the same commands were called with the paths).

## What "last good" means

- **Approved service**: Prepare → Approve pins the saved version; History shows it as "approved" and it is never pruned (CL-002).
- **Service file**: Archive → Share services → "Save this service as a file" carries that service with its songs and pictures (CL-003).
- **Database backup**: Archive → Backups → "Back up now" copies everything (services, songs, history, media index; not the picture files themselves, which live in the media folder).

## Drill

| # | Step | Expected | Result |
|---|---|---|---|
| R1 | On the production laptop: approve Sunday's service, save it as a file, back up the database. Copy both files and the media folder to a USB stick. | Three artefacts on the stick; the app keeps running. | Verified (Mac): approved at revision 5; service file 1.26 MB, backup 0.2 MB and the media folder on the stick; the app kept running. |
| R2 | On the standby laptop (fresh install): Library → "Open a service file…" from the stick. | The service opens in Prepare with every item, song and picture; Home readiness shows no missing songs or pictures. | Verified (Mac): all five items, the song and the picture; nothing missing. Note: approval is not carried in a service file, so the standby's copy is unapproved (with "Ask before showing" on, its first go-live asks). |
| R3 | Still on standby: Library → "Restore from a backup…" with the stick's database, then copy the media folder in. | All services and songs appear; the previous standby database is kept as a snapshot next to it. | Verified (Mac): the service appears approved at revision 5 with its song; the standby's previous database kept as `studio.db.before-restore-<time>.bak`; after copying the media folder the picture item presents. |
| R4 | Back on production: make a wrong edit, save, then History → restore the approved version. | The approved items are back; the wrong version remains in History as a newer entry. | Verified (Mac): the approved items are back (as revision 7, approval moved to it); the wrong version stays in History as revision 6. |
| R5 | Pull the USB during R2 or R3. | The app reports the failure and nothing half-written appears (the checksum or restore verification refuses it). | Verified (Mac): a backup cut short is refused ("database disk image is malformed"); a service file cut short is not readable and a tampered one fails its checksum; with the stick ejected, restore says "Could not read the backup". The standby's data was unchanged each time. |

Time the drill; the target is under ten minutes from "laptop died" to "standby on screen with the approved service".

Timed run (scripted, both profiles on one Mac): 75 seconds from the first step to the standby presenting the approved service. A person using the file pickers needs longer; the target stays ten minutes. Still to do on real hardware: two separate laptops and a physical USB stick pulled during a copy.
