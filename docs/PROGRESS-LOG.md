# Progress log

The durable record of autonomous development (owner directive, 2026-10-23). Newest first. Each entry:
main SHA checked, branch/PR, behaviour, tests, remaining work, blockers, next task, decisions. Task IDs are
the owner's (ARCH-001 to ARCH-005, COMMS-001, MCP-001 in #253); PRD and TASKS reconciliation is the owner's
periodic review, so feature PRs leave those files alone.

## 2026-10-23 — Church colours on library looks, language filter, ready-made feeds (#299)

- **Branch / PR:** `ux15-7/brand-looks-feed-presets` (from `integration/night-2`).
- **Behaviour:** `brand-kit.ts`: `hasChurchColours` (kit differs from the starting colours/fonts), `themeGrounds` (solid text box, else background or each gradient stop, else `CAMERA_GROUND` for keyed looks), `readsOn` (≥ 4.5:1 via `contrastRatio` on every ground), `brandTheme` (words: kit text + body font; reference, second language, verse numbers: kit accent; reference: heading font; background and layout kept; a colour that would not read is kept from the look and reported) and `brandLowerThirdStyle`. `look-library.ts`: `adoptLook(..., { brand })` brands only the copies (theme, lower-third style, a scene's layer themes), suffixes the name with the church name, returns `kept`; `brandable` = theme, lower third, scene (the one ticker / stage look is not offered). Optional `languages` on look metadata (the four tickers with an English tag are `["en"]`); `lookLanguages` (else from fonts: all bundled fonts carry Yorùbá), `showsTwoLanguages` (theme with `secondaryVerseText`, stage, scenes through their layer looks); `LookFilter.language` (`en` / `yo` / `both`). Library view: Language chips, a language line on each card, **Use with church colours** (toast pointing to Brand Kit before it is set; the kept-colour note in the result toast). `feed-presets.ts`: five presets, `readyMadeFeed` (new id, name = NDI source name, `shows`, built-in look with fallback to the main output's, lower thirds / ticker flags, opaque full screens and alpha keyed feeds, browser feeds get a feed token; refuses when an output already has that name or NDI name), `tickerOnly` (signage, ticker on, no pictures, transparent look) so the ticker feed is not flagged as an empty signage loop and its card reads "Ticker only". `ReadyMadeFeeds` menu on Production → Screens (NDI or Browser feed; `addOutput` only, nothing enabled).
- **Tests:** `look-library.test.ts` (+7: Both, single-language theme, Yorùbá vs English tags, system font; brand colours on the copy with library and builtins unchanged, contrast fallback incl. keyed over camera, scenes and name bands, ticker/stage not brandable). `feed-presets.test.ts` (8: names; Bible L3 output shape; lyrics full opaque; ticker feed and its summary; browser token; duplicate NDI name or name refused; look fallback; adding all in the store leaves existing outputs and on-air status unchanged and a second round adds nothing).
- **Next:** desktop acceptance 10dx. Not done: 9:16 looks; church colours on the ticker and stage looks (they replace the church's one look, so left out).
## 2026-10-23 — Rehearsal keeps each screen's scene; dark teal text token; Settings help 12 px (#246, #215)

- **Branch / PR:** `safe-003/rehearsal-scenes-contrast` (from `integration/night-2`).
- **Behaviour:** `RehearsalReturn` now also holds `outputScenes` (each output's `sceneId`) and `sceneReturn`; `setRehearsal(false)` always puts both back (also with `keepRehearsed`, like the lower third and ticker; a scene deleted meanwhile leaves its output on its own feed), so a Take from Programs, the Present strip or `remote:take_scene` / `release_scene` during rehearsal changes the app only (real outputs were already frozen by `syncBroadcastOutputFor`). `outputsForScreens` is what is saved to disk while rehearsal runs, so a restart never shows a rehearsed scene. Present Scenes strip: enabled in rehearsal (matches Show live there: works in the app, undone after), "In rehearsal" instead of "On air", a note line; Programs: "Rehearsal ·" in the program bar, Take brass outline instead of red. New `--primary-text` (light #256d68, dark #5fb3a8; `text-primary-text`) replaces every `text-primary`; `--primary` stays the fill behind white type. Settings (`settings-dialog.tsx`) paragraph/help text `text-[0.6875rem]` → `text-xs`; group headings, badges, small inputs, log rows and status labels left compact.
- **Tests:** `rehearsal-sandbox.test.ts` (+5: store Take/own feed/Restore, Show this live, deleted scene, Programs Take, joined desk `take_scene`/`release_scene`; each checks no send to the real window, outputFrames untouched, saved outputs real, then the real scene back and sent). `scenes-strip.test.tsx` rehearsal test rewritten. `design-tokens-contrast.test.ts` (+7 pairs × 3 modes for `primary-text`, and a guard that no source uses `text-primary` for text).
- **Next:** desktop acceptance 10dw. Joined desks see the rehearsal's scenes in the Live State (with `rehearsal: true`); the Present header chip still names only the program.
## 2026-10-23 — Bring in a previous installation, screen test, Setup status (#298)

- **Branch / PR:** `setup-298b/restore-tests-equipment`. Rust: `rhema_content::inspect_backup` (read-only after `verify_backup`: services, songs (0 without a songs table), newest service and date, last change, `newer` when it has migrations this build does not know) and the `content_inspect_backup` command (reads a local copy, as `content_restore` does). Frontend: `pickBackupFile` / `inspectBackup` / `restoreDatabaseFrom` in `song-files.ts`; `reloadAfterRestore` and `describeError` moved to `studio/library/content-actions.ts` (shared with Archive → Backups). Wizard welcome → `RestoreView` (never saved as `lastStep`). Broadcast store: `outputTests`, `startOutputTest`, `endOutputTest`; `deliver()` keeps each output's newest program frame (`lastProgram`) and holds it back while that output is under test; ending sends it again without `sentAt` (or the output's plain look if it never had one, e.g. frozen by rehearsal). `lib/test-pattern.ts`: pattern drawing, the test frame (pattern as the theme background, so windows, NDI and feed pages draw it with what they have), `testRisks`, `feedAckLabel`. `ScreenTestRow` in the Screens step. `SetupStatusDialog` on `useShellStore.setupStatusOpen`. `resumeStep` and `setupStatusLabel` in `setup-readiness.ts`; shared rows in `setup/status-rows.tsx`.
- **Behaviour:** restore shows what a backup brings in and needs Restore this backup (disabled for a newer backup, an unsaved service or something on air); the test pattern goes only to the chosen output, after one confirmation (two when something is on air, a service is running, an NDI receiver or a feed page is watching), until End test, leaving the step, closing the setup or the output going off. Setup status: three cards with fix links; Desk menu row "Setup status · Complete / Needs N"; Home's card has Setup status.
- **Tests:** rhema-content `a_backup_is_inspected_without_changing_it`; vitest `output-test.test.ts` (7: one output only, held program frames, newest frame back, rehearsal, no frame, removal, browser feed), `test-pattern.test.ts` (5), `screen-test.test.tsx` (9), `restore-view.test.tsx` (6), `setup-status.test.tsx` (5, scenario E: key flagged only when cloud speech is on, saving clears it, never rendered or logged), `setup-wizard.test.tsx` (+6, scenarios G and H), `settings-store.test.ts` (+2, damaged setup section, join keeps local settings), `setup-readiness.test.ts` (+4), `desk-menu.test.tsx` (+1).
- **Next:** desktop acceptance 10dv. Not done: settings, outputs, looks and keys from an old computer (not in a backup file); a test pattern on an output that is off (turn it on in Outputs first); NDI receivers are counted, not asked whether they drew the pattern.
## 2026-10-23 — Camera router inside Rhema; phones join from a camera page (#209)

- **Branch / PR:** `cam-001/bundled-router`. `scripts/fetch-mediamtx.sh` (MediaMTX v1.21.2, SHA-256 pinned per target) → `src-tauri/binaries/mediamtx-<triple>`; release builds add it with `--config src-tauri/tauri.camera-router.conf.json` (`externalBin` is not in `tauri.conf.json` because tauri-build fails when the binary is missing, which would break dev and CI). `commands/camera_router.rs`: config (WebRTC 8889 + UDP 8189, RTSP 8554 TCP only, RTMP 1935, SRT 8890, API 127.0.0.1:9997; HLS, MoQ, playback, metrics off; `webrtcAdditionalHosts` = `remote_lan_address`; publish = one user per camera, `cam-<name>` with its link secret, limited to its own path; read open; the control API only for `rhema-api` (first user) with a per-run random password held in memory and passed as `MTX_AUTHINTERNALUSERS_0_PASS`, the file holding a throwaway value, from 127.0.0.1/::1, `apiAllowOrigins: []`), spawn, log capture, restart with 1–30 s backoff, kill on exit; `camera_router_start/stop/status`, `cameras_set` (rewrites the settings atomically, MediaMTX reloads them, then kicks the sender of a removed or renewed camera through `/v3/paths/get` + `/v3/<kind>/kick/<id>`). Security review fixes: no anonymous `api` (CSRF / DNS rebinding to 127.0.0.1:9997 could have patched `runOn*` hooks); no shared publish password. rhema-api `cameras.rs`: `/camera?name&k` page (`camera.html`, WHIP publisher: back/front, 720p30/1080p30, H.264 first, wake lock) and `/api/v1/camera/{name}/whip[/{session}]` forwarding POST/PATCH/DELETE to the router with Rhema's sign-in, `Location` rewritten. Frontend: settings `cameras`, `cameraRouterAuto`, secret `cameraPassword`; `lib/cameras.ts`; Production → Cameras panel.
- **Tests:** rhema-api (proxy forwards method/body/headers signed in as the camera, refuses without the secret, 503 when off, no `WWW-Authenticate` to the phone; names; Location); app crate `camera_router` (ports, LAN host, per-camera publishers, no anonymous admin action and no CORS origin on the API, per-run API password, bad names/secrets, closed cameras, kick endpoints, binary order, backoff, busy port, paths list); real MediaMTX with the generated settings: anonymous API 401 (config patch refused), no CORS origin, `cam-pulpit` may publish to pulpit only, anonymous publish 401, reading open; a Chrome publisher kicked through the API; `cameras-panel.test.tsx`; `fetch-mediamtx.sh` run for x86_64-apple-darwin, a wrong checksum refused, shellcheck clean. End to end (no desktop app): the real rhema-api listener over https + MediaMTX v1.21.2 on spare ports + headless Chrome with a fake camera: page Live, router path `pulpit` ready, H264 Baseline from `webRTCSession`, Stop removed it.
- **Next:** desktop acceptance 10do (real phone, OBS, Google TV); per-camera read passwords; tally/health in Show health.
## 2026-10-23 — Home Team changes; design docs reconciled with the shell (#215, #299)

- **Branch / PR:** `ux-017/docs-home-team` (from `integration/night-1`).
- **Behaviour:** `teamChanges` (`src/lib/team-changes.ts`) lists, newest first and at most four, the open service's comments from others (`commentKey`/`commentsSeen` mark unread), its newest saved version (`content_list_revisions`, `saved_by`) and its approval (`approved_at/by/revision`, "saved again since" when changed). `TeamChanges` on Home uses the open service, else `todaysService`; no entries, no card. A comment previews its item (`presentActions.previewItem`) and goes to Prepare; a save or approval opens the service if needed (Home's dirty guard) and calls the new `shell-store.openHistory`, which goes to Prepare with `historyOpen` (History's popover state, moved into the shell store like New service). Docs: `03-ux-design-system.md` rewritten for the eight-page shell, Desk menu, transport bar, Production and Design tabs, #215 palette, type and touch rules; `04-screen-flows.md` redrawn; old More / Production view / Display Mode / Show live paths fixed in the acceptance guide, the production guide and the songs design note.
- **Tests:** `src/studio/home/team-changes.test.tsx` (8: ordering and unread, nothing when empty or no service, comment opens Prepare on its item, save opens History, suggested service opened first, blocked over unsaved changes, History opens when asked).
- **Next:** desktop acceptance 10du. `mac-desktop-acceptance.md` keeps the old wording because it records past runs.
## 2026-10-23 — Activate on Bible feeds only, and who activated each source (#243)
## 2026-10-23 — Searchable Settings, touch targets, contrast test, flat surfaces (#215)

- **Branch / PR:** `ux-016/settings-search-a11y`.
- **Behaviour:** `src/lib/settings-search.ts`: `SETTINGS_SEARCH_INDEX` (per section: visible labels + keywords), `searchSettings` (every folded word in name, title, labels or keywords; returns the matching labels), `markSearchHits` (sets `data-search-hit` on short labels in the open section; a MutationObserver re-marks as devices/translations load). `SettingsPage`: search box (type=search, Enter opens the first hit, Esc clears and stops there), a status line with the count or "Nothing in Settings matches" (pointing to Appearance in the Desk menu), nav filtered by hits; GROUPS regrouped to five headings, same section ids and stores. `touch-hit` utility (index.css): an invisible 44 px box centred on a small control; used on the sources strip buttons (strip `gap-y-3`, `py-2.5` so the boxes do not overlap) and "Auto: Bible feeds". Production tabs `min-h-11`; Present/Production icon buttons (aux timers, rundown move/remove, cue step remove, scene composer) 24 → 32 px boxes with the same 12–14 px icons. Paragraph help text raised to `text-xs` in quick-find, ticker, phase strip, production timer note, stage/lower-third/ticker designers, talk, slide composer (2), service bar, item editor, Desk menu (2); compact labels and metadata lines left. Light `--destructive` #c34b4d → #bb4547 (4.30 → 4.70 on the stone page; live red `--on-air`/`--live-pulse` unchanged). Gradients removed: Home hero ornament span, song library tiles (flat slate / teal / ink), unused `VerseCard` (flat ink).
- **Tests:** `src/components/settings-search.test.tsx` (6: search by label, keyword, old "Cloud keys" name, accents; marking; page lists five headings, filters, names labels, Enter opens and marks, nothing-matches and Esc). `src/design-tokens-contrast.test.ts` (94: 31 surface/text pairs × light, dark, live console ≥ 4.5:1, and a parser guard).
- **Next:** desktop acceptance 10dt. Known gap, not changed: `text-primary` (teal) as text on dark planning cards is about 3.0–3.4:1 (e.g. the selected Production tab in dark mode); fixing it needs a separate lighter teal text token. Settings section bodies (src/components) still use 11 px help text.
## 2026-10-23 — Take congregation scenes from Present (#243)

- **Branch / PR:** `sc-003/present-scenes`. New `src/studio/present/scenes-strip.tsx` (`ScenesStrip`), mounted under `LiveOutputPanel` in Present's Standard view (`present-workspace.tsx`; the tour's `[data-studio-live]` stays on the Live panel). Not in the transport bar, and Production → Programs (`scene-composer.tsx`) and `lib/scenes.ts` are untouched.
- **Behaviour:** shown only with a congregation output and a saved scene. Collapsible header lists each congregation output's scene ("Sanctuary: Camera with the Bible · Overflow: its own feed"); with several, a "Which screen" choice. Saved scenes are buttons with a 96×54 `drawScene` thumbnail of how that output would draw them (redrawn only when the scene, what is live or the looks change), pick then **Take scene** → `takeScene(output, scene)`; **Own feed** → `releaseScene(output)`; **Restore** → `takeScene(output, sceneReturn[output])`, all existing store semantics. Unavailable buttons use `aria-disabled` with a reason in the tooltip and a screen-reader description (as in the transport bar). Rehearsal: all three wait with "Rehearsal is on…": the store's `takeScene` sets `sceneId` even in rehearsal and the real screens draw it when rehearsal ends (rehearsal does not save or put back `sceneId`), so Present does not offer it. Black/Logo on air adds "Black covers it".
- **Tests:** `scenes-strip.test.tsx` (6: hidden without scenes or a congregation screen; Take calls `takeScene` for the chosen output only, stage not offered, second screen; Own feed and Restore call `releaseScene` / `takeScene`; disabled reasons and no-op clicks; rehearsal calls nothing; a Take leaves `isLive`, `liveVerse`, `sources` and other outputs alone).
- **Next:** desktop acceptance 10ds. Decide whether a scene Take during rehearsal should be undone when rehearsal ends (Production → Programs and the joined Screens desk can still take one in rehearsal, and it reaches the screens when rehearsal ends).
## 2026-10-23 — Ticker, lower third and logo scene layers; scene presets (#243)

- **Branch / PR:** `sc-002/scene-layers-presets`.
- **Behaviour:** `SceneLayerKind` adds `ticker`, `lowerThird`, `logo` (`normalizeScene` accepts them; older scenes round-trip unchanged; an older build drops the new layers). `sceneFrame` puts the live ticker (`tickerForScreens`), the output's overlay (`overlayFor` with the output's program verse) and the Brand Kit `logoUrl` into those layers, plus the output's verse font for the ticker and lower third. `drawScene` draws the ticker as a band filling its box (speed scaled so the crawl matches the whole-frame ticker), the lower third laid out in its box as on a frame of that size (both through the layer canvas when the layer is see-through), and the logo fitted whole. **Ownership rule** (`sceneOwns`): a scene with a ticker layer, shown or hidden, owns the ticker on its output, and one with a lower-third layer owns the lower third: `syncBroadcastOutputFor` then sends `ticker` / `overlay` null, so output windows, NDI and browser feeds never draw them full frame as well; the layer shows them whatever the output's own ticker / lower-third switch. Ticker, lower-third and Brand Kit logo changes resync outputs whose scene has such a layer. Output windows animate a moving scene ticker or lower-third entrance (rAF on screens, the pacer over NDI, `sceneMoving`) and play their video backings; the browser feed redraws its canvas for them (its strip stays for the whole-frame ticker). Presets: `full-camera`, `pip-camera`, `sermon-split`, `welcome` added after the four existing ids. `scenePresets` (church presets, saved as scenes under the themes file key `scenePresets`, normalized on load): save as preset (new ids, no held copies, same name replaces), rename, delete; composer lists them under "Your presets".
- **Tests:** `scene-layers.test.ts` (12: old scenes round-trip, new kinds load; ticker, lower third and logo draw in their boxes with a mock context, a see-through layer through its canvas; frames carry ticker, overlay and logo, preview labels; the output gets no full-frame ticker or lower third with such a layer, hidden layers still own it, a scene without one leaves it; the layer shows with the output's switch off; a new logo reaches the scene on air; preset ids; save as preset, replace, rename, delete; presets persist and reload).
- **Next:** desktop acceptance 10dr. Not done: a lower third in a scene does not make room for a ticker layer in the same box (arrange the boxes apart); the look library's camera scenes stay in Design → Library.
, and who activated each source (#243)

- **Branch / PR:** `ls-010/bible-activate-actor`.
- **Behaviour:** `activateOnBibleFeeds` (`bible-activate.ts`) is the main desk's Bible-only path (`presentVerse(…, { sourceOnly })`), offered in Detections and Present → Quick find when `bibleFeedCount` > 0 (outputs with `shows` including Bible, or showing a scene with a Bible feed layer). Auto is three-way (`AutoMode`: manual / auto / bible): `autoBibleFeeds` is a new state flag saved under its own key `autoBibleFeeds`, never on with `autoLive`, so a build without it reads it as Auto off; the Live panel's Auto is a select, Settings → Display Mode has a third radio, the sources strip shows "Auto: Bible feeds". `LiveSource.by` (optional) records who: `currentActor()` is the sender of the remote command being carried out (`actingAs`, wrapped round every remote handler in `use-remote-control.ts`) or else Settings → Operator name; presents capture it as they start, so a verse that loads after the handler returns is still the sender's; detections pass "Auto". The host's API now adds `"by"` to every frontend command event it carries for a sender (`Signed` sink in `dispatch.rs`). Live State `sources[]` carries `activatedAt` and `by`; the joined desk shows them; the service log's source lines add "· by …" and now also log a Bible-only activation that replaces the program's own verse on the feeds.
- **Tests:** `bible-feeds-activate.test.tsx` (10: Bible-only activation over a hymn and over a verse on the projector; where it is offered; Auto Bible feeds only on and off air; the three choices; saved key and old settings; `by` locally, under `actingAs`, from `remote:bible_activate` and `remote:verse_next`, in the Live State; the strip label; an old recovery snapshot without `by`). `rhema-api`: `notices_carry_who_sent_them` checks `by` in `bible_activate` and `verse_next`.
- **Next:** desktop acceptance 10dp. Commands started by a cue later in its run (after a wait) or replayed after the approval question are recorded as the main desk's operator.
## 2026-10-23 — The main desk takes back control; commands carry their service (#243, #246 C16)

- **Branch / PR:** `arch-006/reclaim-and-service`. Rust API: `KeyEntry.paused` (serde default false, omitted when false); `RemoteCommand::is_comms` (notices, talk); a paused key's other commands get 423 "The main desk has taken back control" over HTTP (OSC drops them); `/api/v1/me` says `paused`; Live State, `/live/events` and `/voice` stay open. `LiveHub` reads `service.id` of each published Live State (null service = ""; no id = unknown, nothing refused); `/command` takes an optional `service`, and a non-comms command whose service differs gets 409 "That desk is looking at a different service; it will refresh". `join_command` takes `service` and marks 423/409 as `paused:` / `other-service:`. Frontend: `RemoteDevice.paused` (absent = not paused) pushed with `remote_set_keys`; `setDeskControl` (src/lib/desk-control.ts) logs each change; Live State `service: { id, title, revision }` and `paused: [names]`; the join store sends `service`, shows paused, and reconnects on 409.
- **Behaviour:** Take back control / Give control back per device in Production → Operators and Settings → Remote; the paused desk keeps seeing the service, Talk and notices, its controls disabled.
- **Tests:** rhema-api (+5: paused refused/read/talk over HTTP, service 409 and untagged, serde round trips, service read from Live State); app `join` (+2: body carries service, refusals marked); vitest `host-join.test.ts` (+4), `operator-roles.test.tsx` (+2).
- **Next:** desktop acceptance 10dq (two computers). Not done: a revision check on commands (saving a service bumps its revision, so only the service id is compared); per-scope pausing.
## 2026-10-23 — First-install setup and church setup readiness (#298)

- **Branch / PR:** `setup-298/first-install`. Settings gain a versioned `setup` section (`version`, `dismissedAt`, `stepsDone`, `lastStep`, `mode`, `deviceName`, `campus`, `serviceLanguages`, Home card hidden / remind after), read field by field (`normalizeSetup`) so old and damaged files load unchanged; `settingsSaveFailed` (not persisted) notes a failed save. `src/lib/setup-readiness.ts`: `isFreshInstall` (no church or operator name, no saved services, no custom themes or outputs, nothing paired or joined, no church folder, no earlier tour), `churchSetup` (four essentials: church name, operator, Bible on this computer, settings saving; optional items never count), `equipment` (enabled features only: Configured / Connected / Verified / Not tested / Not using; cloud speech counts only once a key is saved or audio consent given). Wizard `src/studio/setup/*` on `useShellStore.setupOpen`; opens by itself once after the saved services load (`decideSetupLaunch`); the first-run tour waits for that decision and does not start by itself once the setup opened (Finish offers it). Join hands over to Production → Operators (`production-tab.ts`). Home: `SetupCard` above the hero, separate from "Your attention".
- **Behaviour:** the Brand step embeds Design → Brand as it is; Screens opens the Outputs dialog (the setup steps aside while it is open) and turns nothing on; Connections links into the owning settings and shows no keys. A renamed church renames its brand themes when the step closes.
- **Tests:** `setup-readiness.test.ts` (21), `settings-store.test.ts` (+3), `setup-wizard.test.tsx` (14: launch once / not for existing data, step navigation, autosave, resume, join hand-off, Bible never invented, Home card shown / hidden / reminded). Desktop: acceptance 10dn.
- **Next:** the Desk menu (#299) calls `setSetupOpen(true)` and can show `Setup: Complete / Needs N` from `useSetupStatus`; import/restore entry, screen test pattern with confirmation (scenario F) and per-output verification remain.
## 2026-10-23 — Built-in look library (#299 UX15-3)

- **Branch / PR:** `ux15-3/look-library`. `src/lib/look-library-data.ts`: 49 original looks in six families (themes, lower-third styles, ticker and stage styles, camera-scene templates whose feed layers name a library theme). `src/lib/look-library.ts`: metadata (layout, content, background, aspect), `filterLooks`, `adoptLook` (copies with new ids, never outputs), `resetCopy`/`themeUsedBy`, per-computer favourites. Design → Library tab (`look-library-view.tsx`) draws previews with the output renderers. Themes gain optional `libraryLookId` (Reset); the four builtins are untouched. Ticker Use saves only the church's ticker look (the one on air keeps its own until restarted); stage Use asks first. Docs: `docs/rhema-studio/look-library.md`.
- **Tests:** `look-library.test.ts` (18: builtin ids, unique ids, core presets per family, every look normalizes unchanged, bundled fonts only, no pictures, filters, Use adds copies and leaves outputs as they were, scenes get their own looks, Reset, favourites). Desktop: acceptance 10dk.
- **Next:** Brand Kit variants of library looks, 9:16 and a language filter (#299 §3), Design → "Used on" with the Output looks retirement (UX15-4).
## 2026-10-23 — Output cards instead of the Output looks table (#299 UX15-4)

- **Branch / PR:** `ux15-4/output-cards`. Design's `outputs` tab (`OutputLooks` matrix) replaced by `used-on` (`UsedOn`: each look → `themeUses()` outputs, main look or kinds; **Open output** → `shellStore.editOutput(id)`, which opens the outputs dialog with that output's editor). `DesignTab` keeps `"outputs"` and `designTabOf()` sends it to `used-on` (`openDesign`, `setDesignTab`); Settings → Screens and global search point at Used on…. Production → Screens: `ScreenRow` → `OutputInspector` cards (`output-summary.ts`: transport, destination, follows, presentation, look thumbnail, language, now, signal; **Edit output**). Output editor: `themeFor` behind **Advanced: content-specific looks** (`ContentLooks`, count in the summary); main theme labelled "Look (main theme)".
- **Fix found here:** saving an existing output dropped `shows` and a renewed `feedToken` (the update listed fields by hand); `outputEditPatch()` now carries both, never `id` or `sceneId`, so saving still never switches a scene. `themeId`, `themeFor`, NDI `sourceName`, output ids and feed tokens unchanged on load.
- **Not done:** named feed defaults (`Rhema Bible | L3` presets) are not offered: no preset mechanism exists to hang them on, and creating senders by default would change what OBS sees. Left for a later slice.
- **Tests:** `output-cards.test.tsx` (Used on lists outputs and opens the editor; the disclosure shows what is set and Save round-trips `themeFor`, NDI name, feed link, no scene; card wording), `output-themes.test.ts` (+1 `themeUses`), `shell-store.test.ts` (+2 legacy `outputs` → `used-on`, edit request). Desktop: acceptance 10dl.

## 2026-10-23 — One place to prepare a service (#299 UX15-5)

- **Branch / PR:** `ux15-5/one-prepare`. Audit of every way into building a service: Prepare is the only editor of the run of show (one `useQueueStore` + `useServiceStore`); Present's "production" view is the original dashboard over the same stores, now labelled Advanced; the More workspace has no way in (#218) and its Classic layout row is gone, Signage points at Outputs. Prepare: `saveStateOf` / `SaveState` chip beside the service name; service bar is a "This service" toolbar with plain titles; Present service says nothing goes live; AI drafts says the draft replaces the rundown being edited; Timing button opens the timing column over the editor below 1280 px (timing-panel.tsx untouched).
- **Tests:** `prepare-no-live.test.tsx` (click, double-click, Present keys and phase strip in Prepare never go live; Present service only switches workspace; saved-state words), `more-workspace.test.tsx` (no Classic layout or planned rows; Prepare and Signage go to the real places; Find anything → New service), `ai-drafts.test.tsx` updated. Desktop: acceptance 10dm.
- **Next:** desktop pass of 10dm; the Desk menu (UX15-1) may link More tools again, which now only points at real places.
## 2026-10-23 — Desk menu; Cloud keys folded into Speech (#299 UX15-1)

- **Branch / PR:** `ux15-1/desk-menu`. `src/studio/shell/desk-menu.tsx`: the sidebar footer is one Desk button (initials, `operatorName` or "Add your name", "Main desk" or the joined role and host from `useJoin`) opening a Popover: name saved on Enter/blur/close (Escape reverts), Light/Dark/System through the existing `useTheme`, Settings, Complete setup (`setSetupOpen(true)`, #298's wizard), Keyboard shortcuts (`ShortcutsDialog`, focus back on the desk), Help, Diagnostics, About (version). The Local-first card and the footer Settings button are gone; Cmd/Ctrl+, unchanged. Settings: `api-keys` and `appearance` sections removed; `openSettings`/`setActiveSection` map `api-keys` → `speech`; Speech's Deepgram key gains Show/Hide and Clear (store and keychain code untouched); Find anything's "Keys" entry folded into Speech recognition.
- **Tests:** `desk-menu.test.tsx` (name in place on Enter and blur; Complete setup; Settings; Light/Dark/System; joined role), `settings-dialog.test.ts` (the redirect). Desktop: acceptance 10di (unverified).
- **Next:** UX15-2 (Present transport). The top bar's "Offline-ready" chip is a separate element and was left for a later slice.
## 2026-10-23 — A compact transport bar in Present (#299 UX15-2)

- **Branch / PR:** `ux15-2/present-transport`. The boxed strip in `present-workspace.tsx` becomes `present/transport-bar.tsx`: left Previous / Next (with the "Next: Chorus" hint) and Previous / Next verse; middle one **Take live** (was "Show live"; still `presentActions.showLive` → `remoteActions.sendToLive`) with what is in Preview and where it goes; right Clear / Restore. Layout by container query on the bar's own width (58 / 46 / 32 rem), so it collapses to icons with tooltips and puts Take live on its own row on a half-size window. A control that cannot act stays focusable with `aria-disabled`, a tooltip and an `aria-describedby` reason; a click does nothing. Take live now waits for something in Preview (it was a no-op before, but could still raise the approval question).
- **Unchanged:** every keyboard shortcut (`present-keys.ts` and the Standard view's listener are untouched; Take live has no key, as before), quick screens (Black stays in One-touch moments), auto-live, rehearsal, the toolbar's name for the tour. "Show live" copy renamed to Take live in Quick find, Team, Settings → Display Mode, the Live panel's Auto tooltip, the cue list and the tour (the Detections list's own button is left as it is).
- **Tests:** `transport-bar.test.tsx` (each button reaches the same `remoteActions` verb; every control that cannot act gives a reason and does nothing; exactly one Take live and its target text, rehearsal included). Desktop: acceptance 10dj (1280×720, 1024×600, half-size).
- **Next:** UX15-3 built-in looks.
## 2026-10-23 — Google TV receiver (#198 Phase B start)

- **Main checked:** 0a68c8a. Owner gave adb access to a Chromecast with Google TV HD (no browser; WebView 155; 32-bit; 1.4 GB).
- **Branch / PR:** `op-007/tv-receiver`. `android-tv/`: Rhema Receiver, Java + WebView, built by `build.sh` with the SDK tools (no Gradle). Shows one browser feed full screen; address + six-digit code until assigned; `POST :8095/show {code,url}` (feed links only; five wrong codes lock until OK on the remote; new code after each use); keeps the feed across restarts; keeps the last picture and retries while Rhema is gone; says when the link was renewed (403). Host: `tv_show` (join.rs) and "Show on a Google TV" in the feed's settings.
- **Tests:** Rust `a_tv_address_may_leave_out_the_port`. Desktop + TV: acceptance 10dh (feed, Yorùbá, ticker ~60 fps, restart, host loss, lock).
- **Toolchain (owner approved):** Temurin JDK 17 in `~/.local/jdk`, Android SDK (platform 34, build-tools 34) in `~/.local/android-sdk`.
- **Cameras on the TV:** iPad (Larix, RTMP then SRT) and an Android phone's Chrome (MediaMTX's WHIP page) → MediaMTX on the Mac → TV over WHEP, with the lower third and ticker. Feed page: cameras as `<video>` under the canvas (`cameraBelow` cut-out in `drawScene`), ticker on its own strip canvas, the picture redrawn only when it changes. Measured on the TV (debug build, WebView stats): 30 fps, 0 dropped, buffer 64–79 ms; janky frames 0.3 %. About 1 s iPad → TV over RTMP/SRT; WebRTC from the phone felt faster (owner).
- **Owner decisions:** MediaMTX ships inside Rhema (no separate install); cameras join from a browser page (VDO.Ninja-like, but local), not a paid app.
- **Next:** bundle MediaMTX (pinned, checksummed download → Tauri sidecar, config written and supervised by Rhema); the Rhema camera page (https with Rhema's CA, QR to join); discovery so no address is typed.
## 2026-10-23 — The run of show as a table (#196 Prepare columns)

- **Main checked:** 0a68c8a (PRs #288, #290–#296 merged after desktop QA; real data unchanged, WebKit restored).
- **Branch / PR:** `pt-011/cuesheet`. `cuesheet.ts`: rows from the timing engine's events (plan, actual, expected, offset = actual or expected start − planned start) with a total line per group; `cuesheet-dialog.tsx` from Prepare → Timing → Table, the time typed in place with `DurationInput`.
- **Tests:** `cuesheet.test.ts` (groups, offsets done / on now / to come, hard stop); `timing-panel.test.tsx` renders the table. Desktop: acceptance 10dg.
- **Next:** Google TV receiver (#198 Phase B) now that the owner gave a test device.

## 2026-10-23 — Words while a camera is not playing (#213 fallback)

- **Branch / PR:** `sh-003/camera-fallback`. `SceneLayer.cameraFallback` (≤120 chars) → frame `fallback` + the output's look; `drawScene` fits it in the camera's box (shared `fitText` with the clock) whenever the camera is not ready, outputs only. Composer field.
- **Tests:** `whep-cameras.test.ts` (+1: kept, framed, drawn only while the camera is not playing). Desktop: acceptance 10dc.4.

## 2026-10-23 — Readiness checks the plan and cameras (#213 preflight, #196)

- **Branch / PR:** `sh-002/preflight-timing-cameras`. `readiness.ts`: `planCheck` (the timing engine on the plan alone: planned end, items planned more than 30 s past their end by) and checks `timing-start` (info), `timing-end-by` (warn), `timing` (ok), `cameras` (info); `use-readiness.ts` feeds them.
- **Tests:** `readiness.test.ts` (+2). vitest 743. Desktop: checked with the combined QA build (Pass 2026-10-23 (combined QA build), on Home: no start time → info; an item planned to end 30 min after its end by → warning naming it and both times; a camera layer with no address → info. ("Planned to end at …" is listed only when nothing needs attention.)).

## 2026-10-23 — Time warnings on the stage (#196 R6)

- **Branch / PR:** `pt-009/stage-time-warnings`. `StageStyle.warnAtMinutes` (0–30) and `warnWhenOver`; `stage-time-warnings.ts` watches the timer's ticks and sends one stage message as each is crossed (per timer run; not when started past it; never in rehearsal; never over a person's message). Stage designer: Time warnings.
- **Tests:** `stage-time-warnings.test.ts`. Desktop: acceptance 10df.
## 2026-10-23 — The service log survives a crash (#196 R3, #246)

- **Branch / PR:** `pt-008/journal-recovery`. `live-recovery.ts`: the journal (entries, `startItemIds`) kept in `recovery.json` under `journal`, 3 s after it changes; `restoreJournal` after an unclean exit, once, if under 6 h old, before anything this run logged already (a scene put back at start-up), rebasing `mono` from `at` on this run's clock, with a recovery line.
- The service timer is in the snapshot (length, elapsed, running; saved when it starts, pauses, resets or is corrected) and Put back restores it, counting the time Rhema was closed, unless a timer was started since.
- **Tests:** `live-recovery.test.ts` (restored after a start-up entry, durations kept, only once, never an old log; the timer). Desktop: acceptance 10da.4–5 passed on the combined QA build after the start-up fix. Real data unchanged, WebKit restored.
## 2026-10-23 — Planned time as typed (#196 R4)

- **Branch / PR:** `pt-007/duration-entry`. `run-of-show.ts`: `parseDuration` / `formatDuration` (to the second, ≤ 600 min); Prepare's planned-time field is a `DurationInput` (applied on Enter / blur, Escape undoes, a mistake is marked).
- **Tests:** `duration.test.ts` (every form, the limits, round trip). vitest 744. Desktop (combined QA build, 2026-10-23): Prepare → Timing on a song: "1h10" → 70 min shown 1:10:00; "4:30" → 4.5 min; "abc" marked, plan unchanged; Escape back to 4:30.
## 2026-10-23 — The service timer from a Timekeeper desk (#196 R5)

- **Branch / PR:** `pt-010/remote-timer` (on `pt-006/shared-offset`). Remote commands `timer_start`, `timer_pause`, `timer_adjust` (±10 a step; Timekeeper/Present/Configure; with who) → the timer store and a log line. `LiveStateV1.timer` (length, elapsed, running) published on each timer change; the desk (`DeskTimer`) counts on from when the state arrived (`useJoin.receivedAt`, no clock skew between computers).
- **Tests:** rhema-api (serde, the ±10 clamp with who, roles); remote-events list. Desktop: acceptance 10de.3.

## 2026-10-23 — Running late, shared by every desk (#196)

- **Branch / PR:** `pt-006/shared-offset`. `service-offset-store.ts` (minutes, by; −120…+240; logged; zero for another service) replaces Prepare's local `delay`; used by `useServiceTiming`, `stage-finish`, `live-state` (`timing.offsetMinutes`, `offsetBy`). Remote command `event_offset` (Timekeeper/Present/Configure, ±30 a step, with who). Production Timekeeper "Running" row; ClockDesk ±5.
- **Tests:** `service-offset-store.test.ts`; rhema-api (serde, dispatch with who and the 30 min clamp, roles). Desktop: acceptance 10de.
## 2026-10-23 — Priority talk; a revoked device leaves the talk channel (Rhema Comms C4, #251)

- **Branch / PR:** `comms-005/priority-revoke`. `voice.ts`: talk target `priority` (main desk only; heard by all); while the main desk holds Talk on it, every other speaker's gain for every listener is 0.2 (`rewire` on Talk and release). The hub drops a peer whose device is no longer paired (settings subscription).
- **Tests:** `talk.test.tsx` (priority heard by all, its name). Desktop: acceptance 10dd. Real data 6/6, WebKit restored.
## 2026-10-23 — Look and scene suggestions in AI drafts (MCP-004, #252)

- **Branch / PR:** `mcp-004/look-suggestions`. `mcp_drafts.rs`: `Looks` (built-in names plus `broadcast-themes.json` custom looks and scenes, read-only), `check_with` keeps `suggested_look` / `suggested_scene` (80 chars) and warns on unknown names; `mcp.rs`: `rhema_list_looks_and_scenes`, schema fields. Review shows them per item; `draftToRundown` does not carry them (decision: suggestions, not a data-model change).
- **Tests:** Rust `suggested_looks_and_scenes_are_kept_and_checked_against_the_church_s`; `builtin-looks.test.ts` keeps the Rust list equal to `BUILTIN_THEMES`. Desktop: `Rhema --mcp` (QA build, QA profile) over stdio: the tool is listed and names the 4 built-in looks, the profile's 7 own looks and 5 scenes; a draft with an unknown look and scene got both warnings; a known look typed in capitals was saved as the church spells it (that last part found here and fixed).

## 2026-10-23 — Cameras in scenes (OP-009, #209)

- **Branch / PR:** `op-009/whep-cameras`. `SceneLayer.cameraUrl` (WHEP), `src/lib/whep.ts` (`WhepPlayer`, `syncCameras`: receive-only, muted, retry every 4 s), drawn by `drawScene` (cover, crop); output windows signal through `whep_offer` (Rust, church-network addresses only: the windows' CSP keeps them from other hosts); browser feed pages fetch the WHEP address directly; a playing camera is drawn by the frame pacer at 30 fps on screens too.
- **Found on the desktop and fixed:** camera decoded but never drawn (animation-frame loop in a locked window; first frame not reported).
- **Tests:** Rust `cameras` (address check); `whep-cameras.test.ts` (fields, frame, player bookkeeping). Desktop: acceptance 10dc (stand-in WHEP camera). Screenshots in local `qa-screenshots/cameras/`. Real data 6/6, WebKit restored.
- **Still needs the owner:** MediaMTX and real phone cameras (#209), OBS and a Google TV.

## 2026-10-23 — Secure phone page (https) with a local CA (#251)

- **Branch / PR:** `comms-004/https-phones`. `rhema-api` `tls` (rcgen: local CA, 397-day server certificate, rustls config) and an https listener on the HTTP port + 1 (tokio-rustls + hyper-util, same router, peer address kept); `/rhema-ca.pem`; app `phone_tls` (CA in app data `tls/`, key 0600), `start_http(https)`, `tls_port` in status; Settings checkbox (off by default), pairing QR uses https when on.
- **Tests:** rhema-api `tls` and an https round trip trusting only the CA; listener restart test. Desktop: see acceptance 10cu.12. Real data 6/6, WebKit restored.

## 2026-10-23 — Voice: one consumer per remote track; where the delay builds up

- **Branch / PR:** `voice/one-consumer`. The host hub no longer plays each desk's track into a muted `<audio>` element; WebAudio is its only consumer.
- **Measured:** the delay builds up in the receiver's jitter buffer (target 40 ms, actual 323 → 1222 ms, samples dropped to catch up): playout ~10% slower than real time with the screen locked. With the extra element it grew from the start; without, a direct loop held ~121 ms for four rounds. Three-desk test unchanged (full duplex, no self-echo). Needs the unlocked two-computer rehearsal (ADR 0002 §4). Real data 6/6, WebKit restored.

## 2026-10-23 — Phone Talk (Comms C4)

- **Branch / PR:** `comms-004/phone-talk`. `remote.html` Talk: join (getUserMedia, offer to `/api/v1/voice` with the phone's key), hold to talk (pointer; release, blur, hidden page and leaving stop it), leave; a note where the page is not secure.
- **Tests:** `phone-remote.test.ts` (insecure page: note, no button). Desktop: headless Chrome with a fake microphone as the phone against the QA build (http://127.0.0.1 is a secure context): joined in ~1 s; crew marks followed press and release; a desk heard the phone only while it held Talk (first sound 0.3–0.7 s after a press, beep spacing included). The same run showed the delay build-up across processes (sound arriving seconds late): see the one-consumer fix PR and ADR 0002 §4.

## 2026-10-23 — MCP-003: prompts and draft revision (#252)

- **Branch / PR:** `mcp-003/prompts-revise`. `prompts/list`, `prompts/get` (`draft_service`, `reuse_service`, `check_service`); tools `rhema_list_service_drafts`, `rhema_update_service_draft` (`mcp_drafts::list`, `update`); Prepare shows "revised".
- **Tests:** `mcp` tests (prompts, unknown prompt / missing argument refused, read-only flags) and `mcp_drafts` (list, revise in place, bad id, removed draft). Desktop: `Rhema --mcp` over stdio from a script acting as the assistant: prompts, create, revise, unknown id refused, list; Prepare → AI drafts showed "revised" with three items. Real data 6/6, WebKit restored.

## 2026-10-23 — Production guide: when something fails (Comms C5 / #246 failure semantics)

- **Branch / PR:** `docs/when-it-fails`. A table of failures (network or listener, a joined computer, the talk channel, a stuck browser page, an NDI sender, a projector or sleeping display, Rhema itself), what keeps working, what the operator sees and what to do; each from behaviour verified on 2026-10-23.

## 2026-10-23 — Clock layer modes (#196 R2.4 / R2.6 / R2.7)

- **Branch / PR:** `arch-002/clock-modes`. `SceneLayer.clockShows` ("timer" default, "time", "until") and `until` ("HH:MM"); `untilClock` (today's, tomorrow's past 12 h), `clockText` "time"; composer "Shows" and the time field; normalize keeps valid values only.
- **Tests:** `scene-contracts.test.ts` (countdown, tomorrow, invalid, time of day, frames). Desktop: acceptance 10cx.4. Real data 6/6, WebKit restored.

## 2026-10-23 — Fixes from an independent review of the day's work

- **Branch / PR:** `review/today-fixes`.
- **Fixed:** the main desk's microphone could stay open (release during the permission prompt, double tap); talk routes per speaker/listener map, rebuilt on node change; late answers drop their peer; paired names unique and never "host" / "Main desk"; the service log records each remote command from one `remote:audit` event after it ran (no swapped names; OSC named); quick screens no second source line; browser feed clocks count by the host's time; trimmed recovery snapshots keep the live sources; snapshot saved as rehearsal starts; any orderly exit is clean (`RunEvent::Exit`); a desk closed while joining leaves.
- **Tests:** rhema-api 133 (audit event, unique names); `live-recovery.test.ts`, `source-followers.test.ts` (fails without the fix). Desktop: the host-mic release case (Desk A heard nothing, −192 dB), six concurrent commands from two devices all named right, channel and three-desk tone tests unchanged.
- **Found and recorded, not fixed:** voice delay builds up over seconds in single-window QA with a locked screen, also in a plain WebRTC loop (ADR 0002 §4); needs the two-computer rehearsal. A desk-side gain tried for it was reverted.

## 2026-10-23 — Show health (#213 P1, first slice)

- **Branch / PR:** `show-health`.
- **Behaviour:** `src/lib/show-health.ts` (`attention`, `showing`, `useFeedHealthStore`); Production → Screens rows with kind (browser feeds fixed), role, follows, showing now and signal; Needs attention list (NDI failing, NDI with no receiver, feed behind, feed with no page), real signals only.
- **Tests:** `src/studio/show-health.test.ts`; vitest green. Desktop: acceptance 10db.1. Real data 6/6, WebKit restored.
- **Not in reach yet (#213):** cameras, TV receivers, A/V alignment, LAN-off lab: need cameras / MediaMTX / a Google TV (owner).

## 2026-10-23 — Execution history: who did it, and scene takes (#246 C17)

- **Branch / PR:** `history/scenes-actors`.
- **Behaviour:** `dispatch_as` emits `remote:actor {by}` before a screen command's event (not for notices / voice); `noteRemote` appends "· by <name>"; journal kind `scene` for Takes and releases.
- **Tests:** rhema-api (actor before the command; the HTTP test sink counts commands only); `source-followers.test.ts` (SCENE lines). Desktop: acceptance 10cw.3. Real data 6/6, WebKit restored.

## 2026-10-23 — COMMS-001 C4 (part): talk channels and private calls

- **Branch / PR:** `comms-004/channels`.
- **Behaviour:** `voice_channels {listen, talk}`; host routing matrix (one gain per speaker → listener, `rewire`, `hears`); Talk to (All crew / channel / Only…) on both desks, Hear checkboxes on joined desks; crew list shows targets.
- **Tests:** rhema-api (`voice_channels` parse, 28 commands); `talk.test.tsx` (routing rule, names); in-app tone test (ADR 0002 §2a). Real data 6/6, WebKit restored.
- **Remaining C4:** phone voice (HTTPS decision), priority controls, revocation from the talk channel (revoking a key already ends its access at the next request; an open call continues until it leaves).

## 2026-10-23 — Recovery after an unexpected close (#246 live safety)

- **Branch / PR:** `live-recovery`.
- **Behaviour:** Rust `running.lock` in the app data folder (made at start, removed on the clean close path), `last_exit_unclean`; `src/lib/live-recovery.ts` keeps `recovery.json` (program, sources, outputs on, scenes, event; not in rehearsal; big pictures by name only) and offers it after an unclean exit when under 6 h old and something was up; `RecoveryBanner` (Put back / Not now); journal kind `recovery`.
- **Tests:** `app_close` lock test (Rust); `src/studio/live-recovery.test.ts` (snapshot, offer rules, put back, log). Desktop: acceptance 10da. Real data 6/6, WebKit restored.

## 2026-10-23 — ARCH-002: scene transitions

- **Branch / PR:** `arch-002/scene-fade`.
- **Behaviour:** `Scene.fadeMs` (0–3000; absent: cut) in `SceneFrame.fadeMs`; composer "Take: Cut / Fade 0.3 / 0.5 / 1 s". Output windows and the feed page snapshot the previous picture and cross-fade when the scene up changes (Take, release, another scene); Black / Logo always cut; a fade is motion (NDI pacer); a timer ends the fade when no animation frames come (covered or locked window).
- **Tests:** `scene-contracts.test.ts` (fade kept and clamped, in the frame, none for a cut); vitest green. Desktop: acceptance 10cz.1. Real data 6/6, WebKit restored.

## 2026-10-23 — Browser feed health (#246 item 9, receiver trust)

- **Branch / PR:** `arch-002/feed-health`.
- **Behaviour:** feed frames are numbered (SSE event id); `feed.html` acknowledges each drawn frame (`POST /api/v1/feed/{id}/ack?k=`, never ahead of what was sent); `FeedHub::status` / `feed_status` give pages following and the newest acknowledged frame; the output card shows the health (`useFeedHealth`, `feedHealthLabel`; "behind" after 3 s).
- **Tests:** rhema-api 131 (ids in the stream, watching count, ack only with the secret, never ahead); `browser-feeds.test.ts` (wording); vitest green.
- **Desktop:** acceptance 10cv.4. Real data 6/6, WebKit restored.
- **Next:** congregation scene transitions / presets, or #198 TV setup (QR for the feed link).

## 2026-10-23 — Browser feed QR code (#198)

- **Branch / PR:** `arch-002/feed-qr`. `FeedLink` (output editor) draws a QR code of the LAN link with the existing `qrcode` package; none when the listener is on this computer only.
- **Tests:** `src/studio/feed-link.test.tsx` (LAN link and QR; loopback: link, no QR). Not checked on the desktop: opening the QA listener to the network can raise a macOS firewall prompt.

## 2026-10-23 — COMMS-001 C3: full-duplex Push-to-Talk (LAN)

- **Branch / PR:** `comms-003/voice`. ADR 0002 (`docs/rhema-studio/23-adr-0002-comms-voice.md`).
- **Behaviour:** API: `POST /api/v1/voice` (complete SDP offer with the desk's key → the host window's answer, 10 s), `VoiceHub`, commands `voice_talk` / `voice_leave` (any paired desk). App: `voice_answer`, `join_voice`. Frontend: `src/lib/voice.ts` (host hub that mixes each desk's voice into everyone else's track and the main desk's monitor; `TalkClient` for joined desks; speaking meters; `setVoiceVolume`), `src/studio/talk.tsx` (hold-to-talk with release on up / cancel / blur / hidden; crew list), top-bar Talk on the main desk, Talk section on a joined desk, `voice` in the Live State.
- **Found on the desktop and fixed:** suspended AudioContext silenced the first desk; meters off the output path read stale; desks lingered after leaving (explicit `voice_leave`).
- **Tests:** rhema-api 132 (voice offer round trip with the key, 401, bad SDP, late answer; `voice_talk` / `voice_leave` parse); `src/studio/talk.test.tsx` (talk only while held); vitest green. In-app tone test and audio-clock latency: see ADR 0002 §5; results kept in local `qa-screenshots/voice/`.
- **Not verified:** real microphones and headsets, echo, two computers, CPU with 6+ desks; phones (need HTTPS: owner decision, ADR 0002 §3).

## 2026-10-23 — ARCH-002: clock layer in scenes

- **Branch / PR:** `arch-002/clock-layer`.
- **Behaviour:** scene layer kind `clock` (`SceneClock {mode, at, text}`; `sceneClock`/`clockText` in `lib/scenes.ts`): the frame carries the countdown's end (or the count-up's start) as wall time; outputs, browser feeds and the composer work out the time. Frames are resent only when the timer object changes (start, pause, reset, minutes), not on its ticks. A running clock asks the Rust pacer for 1 frame a second (display and NDI), since WebKit held a locked screen's timers back ~15 s (found on the desktop). Drawn straight into its box in the look's text style, sized to fill it.
- **Tests:** `scene-contracts.test.ts` (still / down / up, stops at 0:00, normalize keeps clocks, no resend on ticks); vitest 724.
- **Desktop:** see acceptance 10cx (projector canvas frames in local `qa-screenshots/clock-layer/`). Real data 6/6, WebKit restored.

## 2026-10-23 — Phone remote: live sources and notices (ARCH-001 leftover; Comms paired phones, text)

- **Branch / PR:** `arch-001/phone-sources`.
- **Behaviour:** `remote.html` reads `/api/v1/live` and `/api/v1/me` with the phone's key; lists live sources with Take off / Put back (`clear_source` / `restore_source`, the host's role checks apply); shows the notices for the phone's role (plus everyone's and its own) with Seen / Ready / Unable (`notice_ack`) and a message box to the main desk (`notice_send`). DOM built with textContent only.
- **Tests:** `src/studio/phone-remote.test.ts` loads the real page in jsdom with a mocked computer (rows, Bearer key, the four commands); rhema-api phone page test; vitest green.
- **Desktop:** acceptance 10cy (headless Chrome at 390 px against the QA build; screenshots in local `qa-screenshots/phone-remote/`). Real data 6/6, WebKit restored.
- **Blocker for phone voice (C4):** browsers give the microphone only to secure pages; the phone page is plain HTTP on the LAN. Needs an owner decision on HTTPS with a local certificate (see ADR 0002 draft in the voice PR).

## 2026-10-23 — ARCH-001 leftovers: stage follows a source; journal source tags

- **Branch / PR:** `arch-001/stage-follows`.
- **Behaviour:** the stage payload uses the output's `feedFrame` (its chosen sources, else the program); the Outputs editor offers "What this output follows" for stage outputs too. Journal entries carry `source` (program entries: their content type's name, shown as "· Hymns" in the log); a new `source` kind records a source changing beside the program (on, off, back), skipped when the source's value is the program itself.
- **Tests:** `src/studio/source-followers.test.ts` (stage following Bible vs everything, fails without the change; the log's entries and text); vitest 722.
- **Desktop (QA build, Intel Mac):** two windowed stage outputs; with the hymn on air "Pulpit stage" (following Bible) showed Romans 8:28 (KJV) and "Band stage" the hymn line; the journal read live Bible / live Hymns / Bible off / Bible back. Screenshots in the local `qa-screenshots/stage-follows/` (not committed). Real data 6/6, WebKit restored.

## 2026-10-23 — COMMS-001 C2: action requests

- **Branch / PR:** `comms-002/action-requests`.
- **Behaviour:** `NoticeIn.action {kind, value}` (API: kinds bible / scene / event only, value capped at 120); the host store keeps a checked `action` on each notice (`asAction`). Notices panel: "Ask to show a verse / take a scene / start an item" when writing; the recipient gets one button, which runs the request through the desk's own path (main desk: `activateBibleReference`, `takeScene`, event clock; joined desk: `bible_activate`, `take_scene`, `event_start` with its key, so the host's role checks apply) and answers Ready. Scene requests switch the outputs already showing a scene, else main (`sceneTargets`).
- **Tests:** rhema-api 130 (action carried, unknown kinds dropped); notices test (button only for the recipient, acts and answers Ready, scene targets); vitest 719.
- **Desktop (QA build, Intel Mac, loopback):** paired Bible and Timekeeper test keys; the Timekeeper's request to the main desk arrived with its action ("shell" kind dropped); the bell read "Notices: 2 new"; pressing "Show Romans 8:28" set the Bible source to Romans 8:28 (KJV), on, and the Live State showed "Tolu (main desk): ready"; the Timekeeper key's `bible_activate` got 403. Window capture failed in this session (bridge and API evidence only). Real data 6/6, WebKit restored.
- **Next:** ARCH-001 leftovers (stage follows a chosen source; journal source tags). Cameras (#209) wait on the owner: the first camera use asks for macOS camera permission, and MediaMTX is not installed.

## 2026-10-23 — ARCH-002 slice 2: browser feeds (#198 groundwork)

- **Branch / PR:** `arch-002/browser-feeds`.
- **Behaviour:** API: `FeedHub` (feeds by id with their secret, current frame, broadcast), `/feed/{id}?k=` (the built `feed.html` via `CommandSink::asset`), `/api/v1/feed/{id}/events?k=` (SSE), `/assets/{*path}` (built code only); app: `feeds_set`, `feed_publish`, `TauriSink::asset` (Tauri's asset resolver). Frontend: output type `browser` (`outputOnAir` everywhere), `deliver()` routes every frame (congregation, scene, stage, signage) to the feed hub for browser outputs while on; start/stop without windows; `lib/browser-feeds.ts` (secrets, registry sync, link); Outputs editor: Browser Feed option and link with Copy / New link; `feed.html` + `src/feed.ts` (same renderer: looks, scenes, stage, lower third, ticker; transparent background; no video).
- **Tests:** rhema-api 130 (feed secrets, page, assets, stream, renewal); `src/studio/browser-feeds.test.ts`; full vitest 718.
- **Desktop (QA build, Intel Mac, loopback):** the served page (200; wrong secret 403; its code from `/assets`) drew Romans 8:28 in the Lower Thirds look on a transparent background in headless Chrome at 1920×1080; a hymn going live left the Bible feed on Romans 8:28; off sent `{off:true}`. OBS and a second computer not yet tried. Note: a build started with a plain `&` was killed before bundling; QA builds must run as background tasks. Real data 6/6, WebKit restored.
- **Next:** C2 action requests.

## 2026-10-23 — COMMS-001 C1: production notices (#251)

- **Branch / PR:** `comms-001/notices`.
- **Behaviour:** commands `notice_send {text, to, priority, event}` and `notice_ack {id, state}` (all roles); `CommandDispatcher::dispatch_as` stamps the sender with the key's own name (HTTP), "a remote" otherwise; `src/stores/notices-store.ts` (last 100, 280 characters, answers once per person, `isFor`); Live State v1 carries the last 50; `src/studio/notices-panel.tsx` shared by the main desk's bell (unread count, red when urgent) and the joined desk's Notices section; never on outputs or in the journal.
- **Tests:** rhema-api 130 (sender stamping, bounds); `src/studio/notices.test.tsx`; pinned event names; full vitest 716. Desktop (QA build, Intel Mac): curl as the paired Timekeeper sent an urgent notice to the main desk; the bell showed it; a forged sender in the request was ignored (the key's name is used); Ready on the main desk reached the Live State; the service log stayed clean. Real data 6/6, WebKit restored.
- **Next:** C2 action requests (a notice that opens the item, verse or scene it is about on the recipient's desk), then the speaking/PTT phases.

## 2026-10-23 — MCP-002: AI service drafts for review

- **Branch / PR:** `mcp-002/drafts` (stacked on #262).
- **Behaviour:** `src-tauri/src/mcp_drafts.rs` (`check`: titles, dates, HH:MM, roles once each, kinds, minutes 0–240, at most 200 items, songs matched by id / exact title / other title / number, references via `mcp::find_passage`, missing placeholders; `save`: `ai-drafts/<uuid>.json`, atomic write, at most 50 waiting, client name from `initialize`); tools `rhema_validate_service_draft`, `rhema_create_service_draft` (only non-read-only tool); app commands `ai_drafts_list`, `ai_draft_delete` (UUID ids only); `src/lib/ai-drafts.ts` (`draftToRundown`); Prepare → AI drafts dialog (asks before replacing a rundown; opens unsaved).
- **Tests:** app `mcp` 6 (incl. a Thanksgiving draft against the real KJV and named mistakes); `ai-drafts.test.ts`, `ai-drafts.test.tsx`; full vitest 716.
- **Desktop end-to-end (QA build, Intel Mac, scratch QA profile):** a stdio session as "Claude" validated then created a Thanksgiving draft (Amazing Grace, the CAC hymn "Now thank we all our God", KJV Psalm 100:1-5, slides; 47 min); Prepare → AI drafts listed it and Open as a new service loaded all five items marked "AI draft · Claude" with Warm-up and Main service 10:00; nothing saved or approved. Window capture failed that run (bridge evidence only). Real data 6/6, WebKit restored.
- **Next:** Comms notices (#251) on the Host/Join channel.

## 2026-10-23 — MCP-001: the read-only Rhema MCP server (#252)

- **Main checked:** `f55eab9` (#260 merged). #261 (Bible and Screens roles) open.
- **Branch / PR:** `mcp-001/read-only`.
- **Behaviour:** `Rhema --mcp` serves MCP (JSON-RPC over stdio) before any window or single-instance handling; opt-in via `mcpEnabled`; `ContentDb::open_read_only` (read-only flag, refuses newer schemas) and the immutable Bible database; tools `rhema_get_capabilities`, `rhema_list_services`, `rhema_get_service`, `rhema_search_songs` (no lyrics), `rhema_list_translations`, `rhema_lookup_bible_reference` (numbered books normalised, ranges bounded). Settings → AI assistants (switch, configuration with this app's path, privacy note). Docs: `docs/rhema-studio/22-rhema-mcp.md`.
- **Tests:** content `read_only` 1; app `mcp` 4 (protocol and opt-in, reading services, real KJV John 3:16 and 1 Cor 13:4-7 when the Bible database is present, reference parsing); Settings section 1; full vitest 714. Real binary over stdio (QA build, scratch copy of the QA profile): off → every tool refuses with the Settings hint; on → capabilities, services, KJV Romans 8:28, OYCB Psalm 23 with Yorùbá diacritics intact, songs and hymns without lyrics. Found and fixed: a database the updated app has not opened yet is now refused with "open Rhema once" instead of a raw SQL error.
- **Next:** MCP-002 draft-writing (an AI draft in Prepare for review, provenance, missing items), then Comms notices (#251).
## 2026-10-23 — ARCH-004 slice 2: Bible and Screens operators

- **Branch / PR:** `arch-004/operator-roles` (stacked on #260).
- **Behaviour:** commands `bible_activate`, `clear_source`, `restore_source`, `take_scene {output, scene}`, `release_scene` (HTTP, OSC, dispatch, pinned names); roles `bible` and `screens` with their own refusal messages; `src/lib/bible-activate.ts` (`bibleScope` shared with Auto, `activateBibleReference` via the host's own reference parser); Live State v1 gains scenes and congregation outputs; joined desks by role (clock / Bible / scenes; Present gets all).
- **Tests:** rhema-api 129; `src/studio/operator-roles.test.tsx` (Bible rule, desks per role); full vitest 713; app crate check clean.
- **Next:** MCP-001 read-only server (#252), then Comms notices (#251) on the Host/Join channel.

## 2026-10-23 — ARCH-004 slice 1: host and join

- **Main checked:** `00e3e8c` (#256, #257, #258, #259 merged after CI and review; #256's own Rust job was held up by the package mirror, its code passed in full on #257).
- **Branch / PR:** `arch-004/host-join`.
- **Behaviour:** API crate: `LiveHub` (`publish`, `current`, broadcast), `GET /api/v1/live`, `/api/v1/live/events` (SSE, current first, 15 s keep-alive), `/api/v1/me`; paired keys only (keys off: loopback only); commands `event_next`, `event_prev`, `event_start` (HTTP, OSC, dispatch, pinned names); role `timekeeper` (event clock only) with its own refusal message. App: `publish_live_state`; `commands/join.rs` (`join_pair`, `join_me`, `join_command` with idempotency ids, `join_connect` SSE follower with reconnect backoff and a refusal state, `join_disconnect`; host:port validation; bounded buffer). Frontend: `lib/live-state.ts` (Live State v1 builder and publisher, deduplicated, 15 s refresh), `stores/join-store.ts`, settings `joinAddress`/`joinName`/`joinToken` (keychain), Timekeeper role in Settings, Production → Operators (host card, join form, joined Timekeeper desk).
- **Tests:** rhema-api 127 (role, OSC, SSE stream with auth, loopback-only open mode); app `join` 2; `src/studio/host-join.test.ts` (4); remote event names pinned; full vitest 711. Desktop (QA build, Intel Mac, isolated home, loopback): pair as Timekeeper with curl, `/me`, `/live`, the stream carrying none → Welcome → Opening prayer → Welcome while the window was hidden (found and fixed: the publisher used a timer WebKit held back; now a microtask plus the app tick), screen command refused 403, no key 401; the app joined itself via Production → Operators and its Start moved the host's clock with nothing on air. Real data 6/6 OK, WebKit restored.
- **Decisions:** Live State is a versioned JSON the server passes on unread; a joined computer drives no screens of its own; roles are permissions (Timekeeper first; Bible/worship and screens next).
- **Next:** more delegated roles (Bible operator activating the Bible source, screen operator taking scenes) on the same command path; then MCP-001.

## 2026-10-23 — ARCH-003 slice 3: the event clock (C03)

- **Branch / PR:** `arch-003/event-clock` (stacked on #257 → #256).
- **Behaviour:** `src/stores/event-clock-store.ts` (mode "screens" default / "own", `currentId`, start/next/previous; a start is a journal "event" entry; no starts in rehearsal or from quick screens; reset when another service opens). `journal.ts`: `eventStarts`, `eventTimes`, "event" kept out of screen durations, EVENT in the text log. Timing (`use-service-timing`, `stage-finish`) and item cues (`on-live-cues`) follow the event clock. Production → Timekeeper: event clock bar. QA bridge exposes `eventClock`.
- **Tests:** `src/studio/event-clock-contracts.test.ts` (4, written first); timing tests seed event entries; full vitest 706.
- **Decisions:** "Follows the screens" is the default so a one-person desk works exactly as before; item cues are event cues (same moment in the default mode).
- **Next:** merge the stack (#256, #257, #258, this); then Milestone D's scope-aware cue execution per event, or MCP-001's read-only server.

## 2026-10-23 — ARCH-002 slice 1: Congregation Scene Composer

- **Main checked:** `49b41e0`; #256 (ARCH-003 slice 2) open, its Rust job re-run after a slow package mirror (CI step limit raised to 20 min in this branch).
- **Branch / PR:** `arch-002/scene-composer` (stacked on #256).
- **Behaviour:** scene model (`src/types/scene.ts`, `src/lib/scenes.ts`: presets, normalize, copy, `sceneFrame`, `layerContent`), shared drawer `drawScene`, output window composes `payload.scene`, store `scenes` (saved), `sceneId` per output, `takeScene` / `releaseScene` / `sceneReturn`, `deleteScene` releases; Black/Logo override scenes. UI: Production → Programs (scenes list and presets, live preview with drag/resize/nudge, inspector, program bar with Take / back / Restore). Edits are drafts until Save/Take.
- **Tests:** `src/studio/scene-contracts.test.ts` (6, written after the model), Production composer test (preset → Take → release → Restore); full vitest 700; browser screenshots of the composer with Bible and hymn live side by side.
- **Decisions:** a feed layer draws its look whole, then crop/scale (keyed looks stay keyed); camera layers are labelled placeholders until #209; only congregation outputs take scenes; scene changes reach air only by Save/Take.
- **Remaining for ARCH-002:** clock and lower-third layers inside scenes, transitions, scene presets per church (save as preset), browser-source feeds, NDI/projector hardware checks (10cs).
- **Next:** the Design toolbar overflow at 1024 (sweep), then ARCH-004 groundwork or MCP-001 read-only server.

## 2026-10-23 — ARCH-003 slice 2: rehearsal sandbox, scoped cues

- **Main checked:** `49b41e0` (#255 merged after CI green and review).
- **Branch / PR:** `milestone-a/rehearsal-sandbox` (ARCH-003; ADR 0001 C02 rest, C04).
- **Behaviour:** `RehearsalReturn` adds lower third, ticker, stage message and timer to the snapshot, always restored (Show this live keeps only the program); `tickerForScreens` keeps rehearsal's ticker off signage; the journal drops entries during rehearsal except rehearsal on/off; phase runs carry `rehearsal` and wait while the app is not where they started, catching up on exit, sandbox runs stop on exit; timed moves wait in rehearsal and catch up; `CueScope` on every cue action and `cueImpact` shown under each cue and in the new-cue form.
- **Tests:** `src/studio/rehearsal-sandbox.test.ts` (4) and new runner tests (3), written first (6 failed); full vitest 693.
- **Decisions:** Show this live applies the program only; aux timers are not yet in the sandbox (rehearsal edits to them stay; small).
- **Next:** ARCH-002 Scene Composer (congregation scenes in the main app), starting with the scene model and Take on native outputs.

## 2026-10-23 — ARCH-001 slice 1: independent live sources

- **Main checked:** `f079203` (#254 merged after CI green and review).
- **Branch / PR:** `milestone-a/live-sources` (ARCH-001; ADR 0001 C05, C07, C11).
- **Behaviour:** `src/lib/live-sources.ts` (`sourceOf`, `feedFrame`); store `sources` kept by an adapter from the program (`noteSources`: what goes on air activates its source, Clear/Restore toggle it, other sources untouched, nothing in rehearsal); `BroadcastOutput.shows` (absent = legacy latest-wins); `clearSource`, `restoreSource`, `activateSource`; Black/Logo override every feed; quick screens only on legacy feeds; Auto with a non-Bible program activates the Bible source only. UI: Outputs → "What this output follows"; Present → Live → Sources strip (only when an output follows chosen sources).
- **Tests:** `src/studio/live-sources-contracts.test.ts` (11; 9 failed first), strip test; full vitest 686, typecheck, eslint.
- **Decisions:** an output *is* the feed (no new entity; NDI names and themes unchanged); songs and hymns are separate sources, a lyrics feed follows the newer; the main Clear acts on the program and turns off only that source; quick screens other than Black/Logo do not reach source-bound feeds.
- **Remaining for ARCH-001:** stage display following a chosen source; journal entries tagged with the source; remote/phone view of sources; OBS hardware check (10cr).
- **Next:** ARCH-003 rest (scoped cue steps C04, rehearsal pauses timed moves and loops), then ARCH-002 Scene Composer.

## 2026-10-23 — Milestone A, slice 1: ADR 0001 and live safety

- **Main checked:** `077d454` (CI green). Open PRs before this: #4 only (speech; CONFLICTING with main, owner decision ST-004).
- **Branch / PR:** `milestone-a/live-safety`, PR #254 (ARCH-003).
- **Behaviour:** ADR 0001 (`docs/rhema-studio/21-adr-0001-live-sources-scenes.md`). Rehearsal snapshots the real program and the rundown position and restores them on exit; `showRehearsalLive()` / "Show this live" keeps the rehearsed program behind the approval gate. Designer drafts reach outputs only with Live edit (`liveDesign`), which ends with editing.
- **Tests:** contract tests `src/studio/live-safety-contracts.test.ts` (written first; 5 failed before the change); rehearsal, approval, on-live-cue and Designer tests updated to the ratified contracts; full vitest, typecheck, eslint, CI.
- **Decisions (under the approved principles):** "Rehearsal off" restores rather than shows (C02); Live edit off by default (C01); `rehearsal.off` cue keeps its id with the new meaning.
- **Remaining:** ARCH-001 independent sources and feed binding (next, `milestone-a/live-sources`); ARCH-003 rest (scoped cues, rehearsal timers, event clock); ARCH-002 Scene Composer; ARCH-004 Host/Join; COMMS-001 after ARCH-004; MCP-001 read-only server.
- **Blockers:** Windows smoke (needs the owner's desktop); real OBS/projector checks are hardware acceptance; PR #4 provider decision.
- **Next:** ARCH-001 (independent live sources).
