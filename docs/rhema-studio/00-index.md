# 00 — Index: guides, decisions and contracts

The Markdown in this repository is the source of truth (#413). The website (`site/`) and the in-app help repeat only what is built and tested. What is built, tested on a device or accepted is tracked row by row in [47 — Master build tracker](47-master-build-tracker.md); approved intent is in [32 — Feature coverage inventory](32-feature-coverage-inventory.md).

## For people running a service

| Guide | For |
|---|---|
| [Quick start](../QUICK-START.md) | The volunteer at the laptop: first run, Prepare, Live, Library, Settings, backups, if something breaks |
| [Production guide](../PRODUCTION-GUIDE.md) | Whoever looks after outputs, OBS, cameras, TVs, the stage screen and remote control |
| Role pages on the website (`site/docs/operator-*.html`) | Presenter, Bible, Worship, Timekeeper, Screens, Stage, Camera, OBS and recording, Editor, Viewer |
| [Backup and restore rehearsal](14-backup-restore-rehearsal.md) | Proving a backup restores on the standby laptop |
| [Desktop acceptance guide](08-desktop-acceptance-guide.md) | Step-by-step checks used as evidence in the tracker |

## Decisions (ADRs and owner decisions)

| Decision | Status | Supersedes / notes |
|---|---|---|
| [ADR 0001 — Live sources, feeds, scenes and programs](21-adr-0001-live-sources-scenes.md) | Accepted (owner ratified #243's five principles, 23 Oct 2026) | **#243 v2 is authoritative**; its early per-verse destination idea is superseded. #246 is the cross-feature contract audit it answers to |
| [ADR 0002 — Comms voice (push-to-talk on the LAN)](23-adr-0002-comms-voice.md) | Proposed | #251 |
| [ADR 0003 — Rhema MCP: local, opt-in, drafts only](24-adr-0003-mcp.md) | Accepted for what is built | #252; contracts below |
| [ADR 0004 — Run-of-show timing](25-adr-0004-timing.md) | Proposed (engine on main) | #196 |
| [ADR 0005 — Settings: parts, file, secrets, backups](26-adr-0005-settings.md) | Accepted for what is built | #298 |
| [ADR 0006 — Screens on TVs: feeds and the Receiver](27-adr-0006-tv-receivers.md) | Accepted for what is built | #198 |
| [42 — Rhema Studio records the service natively](42-rhema-native-service-recording.md) | Owner approved (29 Oct 2026) | Replaces OBS-dependent recording; contract `recorder-v1` |
| [46 — Operator pages 1–11 register](46-operator-pages-owner-approval-and-implementation-register.md) | Design decision register | Pages 34–45 are its proposals |
| [48 — Pairing kept across an address change](48-dhcp-address-change-pinning-design.md) | Built (#899, #901, #903, 12 Nov) | Option (a), one server key per local CA |
| [49 — UX audit, 13 Nov 2026](49-ux-audit-2026-11-13.md) | Owner decisions 1–10 taken; slices built #947–#987 | Supersedes the slogan headings and the Production page as a destination |

Architecture background: [02 — Target architecture](02-target-architecture.md), [05 — Domain model](05-domain-model.md), [13 — Remote-control threat notes](13-remote-control-threat-notes.md), [16 — Remote pairing](16-remote-pairing-design.md), [17 — Database migrations](17-database-migrations.md), [18 — Network and privacy](18-network-and-privacy.md), [28 — Unified workspaces](28-unified-workspace-contract.md), [29 — Editor, library and languages](29-editor-language-library-contract.md), [33 — Approved revision integrity](33-approved-revision-integrity.md), [37 — Permissions and authority](37-permissions-sidebar-and-authority-design.md).

**On-prem topology.** One main computer is the authority; joined desks, phones, TVs, cameras and the OBS Companion follow it over the church LAN and keep working offline (ADR 0001 §Host/Join, doc 18). Nothing in Live needs the internet; Engage and cloud speech are the opt-in exceptions.

**Output frame rate.** 1080p30 is the default everywhere; 60 fps is offered only where the computer suits it (capacity limits in Settings → Outputs) and is claimed as working only after a physical check on the device, recorded in the tracker.

## Contracts (typed, between engine and UI)

[approval requests v1](../contracts/approval-requests-v1.md) · [design documents v1](../contracts/design-documents-v1.md) · [host permissions v1](../contracts/host-permissions-v1.md) · [MCP design drafts v1](../contracts/mcp-design-drafts-v1.md) · [plan drafts v1](../contracts/plan-drafts-v1.md) · [recorder v1](../contracts/recorder-v1.md)

## Keeping docs true (maintainer checklist)

- A PR that changes what someone sees or does updates the Quick start or Production guide **in the same PR**, and names the tracker row it moves.
- A page or row says *built*, *tested* or *accepted* only with the PR, test or device check that proves it.
- Run `node scripts/check-doc-links.mjs` before merging a docs change: it fails on a relative link to a file that does not exist.
