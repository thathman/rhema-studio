# Release candidate evidence (RELEASE-PLAN §6)

**Not a release.** This sheet records what is proven about the newest installer build, gate by gate, so the owner can see what a release still needs. Nothing has been published, tagged or deployed. Update it whenever a new installer is built.

```text
Release: none (candidate for R0–R3 review)   Candidate SHA: 4721336
Artifact: GitHub Actions run 39558619566, "rhema-windows-x64-installer"
          (NSIS .exe + MSI, unsigned, with licence page and third-party notices), 99,555,376 bytes,
          artifact digest sha256:a2b11390089efa4bcfe2267ea9142825f62a15dbcdd917fd08b930c6ddd3d4e7, kept 14 days
Responsible engineer: Hendrix Nwaokolo   Owner acceptance: not given
Features/tasks: every merged row in docs/TASKS.md up to PR #125; CHANGELOG.md
Dependencies/migrations/licensing: studio.db migrations 0001–0010 (docs/rhema-studio/17-database-migrations.md);
          licence check in CI (scripts/check-licenses.ts); docs/LICENSES.md (owner decision #33 on bundled translations)
CI: run 39558602844 on 4721336, success (typecheck, 476 tests, build, whole-repo lint, Rust tests/check/clippy, licences)
Real Windows smoke: NOT DONE (no Windows machine in this environment) — issue #32
Projection/NDI/OBS: NOT DONE — acceptance rows 10ab, OBS 720p30 (OP-005)
Offline WAN-disconnect test: NOT DONE — rows 10an.1–2 (code review: no internet on the render path, docs/rhema-studio/18-network-and-privacy.md)
Data persistence/migration/restore: automated tests pass (45 content-crate tests incl. downgrade refusal); desktop drill NOT DONE — #62
Keyboard/accessibility: automated guard (#68); layout measured at 1366x768 in the browser shim (#106, #112); human sessions NOT DONE (QA-003)
Known critical issues: none known in code; all desktop behaviour unverified (docs/KNOWN-ISSUES.md)
Rollback: install the previous build; a newer studio.db is refused by older builds — restore the automatic pre-upgrade copy (17-database-migrations.md)
Decision: NO-GO until the desktop rows below are done and the owner signs off
```

## Gates (RELEASE-PLAN §4)

| Gate | Status | Evidence / what is missing |
|---|---|---|
| RG-01 Device and install | Not met | Installer builds in CI; never installed or launched on Windows (#32). No accounts or telemetry needed to start (code review). |
| RG-02 Novice usability | Not met | Needs volunteer sessions (QA-003). |
| RG-03 Live safety | Code and tests | Preview/Live separation, one writer per content kind, quick screens with Back, Clear/Restore, rehearsal freeze, last good frame (#104/#108), no network on the render path. Desktop rows 1–10 unverified. |
| RG-04 Offline resilience | Code review | No internet host in code except opt-in Deepgram (guard test #105). Unplugged run 10an.2 not done. |
| RG-05 Data integrity | Tests | Revisions and conflicts, migration backup, downgrade refusal (#96), unsaved-work prompt on close (#111), one running copy (#103). Restore drill #62 not done. |
| RG-06 Multilingual fidelity | Tests | Yoruba diacritics in search and storage, pinned translations, missing-translation warnings. Projector font check not done. |
| RG-07 Production interop | Not met | Projector, NDI, OBS 720p30 and display reconnect need hardware. NDI failures are reported and retried once. |
| RG-08 Security and privacy | Code and tests | Pairing, keys, roles, rate limiting (#100), phone remote with strict CSP (#102), diagnostics redaction (#97), network note (#105). Secrets in the system keychain (#115). Consent before cloud audio: asked before the first Deepgram session (PR after #128); PR #4 providers must use the same gate. |
| RG-09 Accessibility and recovery | Partly | Keyboard shortcuts ignore typing; Back always visible at 1366x768; deletes confirm (#107). Automated WCAG 2.1 AA check (axe-core 4.10 in the browser shim, 2026-10-21): Home, Prepare, Present standard and production, More, the first-run tour, Settings, Library, Church brand, Outputs and Themes show no violations after #133 (dark) and #134 (light), except one Radix tab whose panel is not mounted (aria-controls). Hands-on screen-reader and display-scaling checks not done. Browser shim at the minimum window 1024×600 (2026-10-21): Show live, Next, Previous, Clear, Back and all quick screens visible, no page overflow (not desktop evidence). |
| RG-10 Reproducibility | Met for this candidate | SHA and artifact digest above; lockfiles; CHANGELOG.md; migration notes; KNOWN-ISSUES.md; licence manifest, CI check, installer licence page and generated third-party notices (#122). Sign-off missing. |

## R0 checklist (RELEASE-PLAN §5)

- CI on the exact merged commit: done for `4721336` (run 39558602844).
- Windows installer built and recorded: done (above). Launched on Windows: not done; this is the blocker.
- Everything else on the R0 list needs a real desktop or the owner.
