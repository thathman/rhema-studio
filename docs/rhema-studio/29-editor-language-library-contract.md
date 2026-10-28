# 29 — Native design editor, reusable content and single/bilingual output contract

**Owner decisions recorded October 26, 2026. This describes target behavior, not shipped functionality.** Related: Avnac epic #443, implementation #448, language #446, Library #447, UX #442, independent sources #243.

## 1. Decision record

**Embed the Avnac Studio / Saraswati scene graph and selected editing components natively in Rhema Studio.** Use the existing Rhema desktop shell, source buses, router, asset library and authorizations. Do NOT fork its Go/Wails application as a second app or launch an unintegrated Canva web page from the core workflow. Avnac may supply engine/core editing functions, while Rhema supplies worship-specific dynamic nodes and rendering outputs. No second Design data store, duplicated slide editor or incompatible live renderer.

Use **one editor** with progressive disclosure:
- Design > Templates, My Designs, Brand Kit: search by real use (Scripture, bilingual lyrics, lower thirds, ticker, announcement, camera+Bible, timer/stage). The 120 original Worship Expressions looks should have browseable thumbnails and use-without-import (#400; PR #435 must be reviewed). Template browsing is read-only.
- Choose a template (or blank) > large **Fit-to-Window canvas** > select node for compact contextual properties > Save Draft/Create Version. No permanent three-column wall of theme library, tiny 21%-zoom preview and all properties.
- Access same editor from Library > reusable Slides/Announcements, Prepare > Event > visual moment, Live > permitted emergency draft edit, and Production-scene replacement within unified Live. Save returns to caller and selects stable document/revision; no automated live change.
- Template/Design document may have title, page/artboards, layers, background, static text, responsive reading, images/video background references, QR, shapes, opacity, grouping, z-order, alignment, type tokens, saved looks, named output aspect profile. Undo/redo, lock, snap, keyboard, source validation, export/import and offline asset cache.
- User-defined work remains editable. A static exported PNG/video is **media** with provenance, not magically transformed into editable source. Legacy slide payloads migrate via an adapter or explicit compatibility renderer; never discard unknown fields.
- Reusable **Content** (hymn/song/Bible/announcement or media) lives in Library, while reusable **visual recipes** and scene composition live in Design. "Used On" reports actual references/revisions and potential live impact.

## 2. Model and revision boundaries

Illustrative **typed** entities—adapt to existing stores/migrations rather than inserting these interfaces blindly:

- `ContentAsset(id, kind, variants, metadata, sourceVersion)`: Bible/hymn/song/slide/announcement/image/video/audio, with language and rights/source information.
- `DesignDocument(id, revision, artboards[], nodes[], tokens, sourceBindings, mediaRefs)`: versioned editable Saraswati-based canvas.
- `Template(id, designRevision, tags, variants)`: reusable read-only built-in pack or user-saved look; editing a built-in duplicates into My Designs.
- `Event(id, phaseId, duration, speaker, approval, moments[])` and `Moment(id, contentRef?, designRef?, sceneIntent?, trigger?, audienceBindings?)`, consumed by Run of Show #409.
- `LiveSource(kind, valueRevision, actor, appliedAt)`, `Scene(id, designRevision, sourceBindings, outputScope)` and `OutputSubscription(outputId, kind, variant, language, priority, visible)`.
- `ExecutionRecord(commandId, actor, timestamp, approvedRevision, attempted/accepted/rendered/acknowledged, affectedOutputs)`.

**Do not conflate**:
- Updating contents of a reusable design/slide (safe draft).
- Binding a version of that design to an approved service moment (plan change, approval policy).
- Activating Live Bible/Song/Hymn (source change, may update following subscribed scenes).
- Taking/clearing/holding/restoring an output scene (program change).
- Editing a scene *while on air* (separate explicitly armed, scoped Live Edit with undo and audit).

Any source or design adopted for an approved event remains pinned by revision unless owner explicitly approves refresh. Changing a Brand Kit default must not overwrite live scenes silently.

## 3. Language — ONE content model, output-specific presentation

Avoid a "bilingual service wizard" and duplicate language-specific service items. **Every relevant content type may carry zero/one/multiple text language variants**, e.g. EN KJV / licensed Yorùbá Bible, hymns aligned by section, song arrangements aligned by verse and chorus. Content metadata records the actual language, variant, copyright/translation ID and editorial quality. Do NOT use AI to fabricate Bible translations or replace a missing licensed edition without attribution.

**Precedence and behavior:**
1. **Church default:** primary (e.g. EN) and optional secondary (e.g. YO); both may be unset initially.
2. **Library resource:** which editions/arrangements exist (and their source permissions).
3. **Event / item pin:** translations, approved content and arrangement saved for that occurrence. A missing pinned translation is reported, not silently swapped by changes to church defaults. Legacy `null` should preserve existing documented "follow active" behavior unless migrated with consent.
4. **Output policy:** for a particular destination/subscribed variant, show First, Second, or Both (or mapped locale tags). Sanctuary can show EN+YO, OBS EN-only lower third, Stage YO-only with private notes.
5. **Design text layout:** stacked, split-column, alternate page, editorial side-by-side according to reading distance, ratio and content type; auto-fit must remain readable and prefer additional pages/reflow over microscopic text.
6. **Live override:** operator-selected temporary translation change for allowed scope, clearly signaled/audited and never silently rewriting approved event pins. Automatic Scripture detection activation is a **different** permission from language display.

**Align meaning and sections, not just row counts.** Lyrics should retain Intro, Verse, Chorus, Bridge, Refrain order and per-language segmentation; hymnbook number, source catalog and Yoruba tones matter. English and Yorùbá text vary significantly in length. Select line breaks independently but advance the same section together, with operator preview and "Next Section" semantics. Missing secondary: safely show approved primary with explicit UI warning; don't send a blank output, don't invent text.

**Existing source review:**
- `src/lib/translation-policy.ts` already resolves active vs pinned item translations and reports missing editions.
- `src/lib/output-language.ts` already chooses first/second/both and falls back rather than blank output; harmonize with new typed language policies without breaking legacy.
- `src/lib/lyrics.ts` and hymns/services contain existing bilingual behavior. Write parity tests around these before replacing renderer.
- `src/studio/prepare/slide-composer.tsx` is a basic free-text/announcement/QR/responsive-reading composer with media backgrounds and page splitting. Preserve its functionality/migration while adopting native editor; not a full editable scene graph today.

## 4. Source-bound elements and per-output composition

Avnac's canvas should support both static and **typed Rhema-bound nodes**:
- **Planned:** service name/date, event title, speaker, saved Scripture reference, stage schedule, prepared slide page.
- **Live:** `LiveBible.Reference/Text`, distinct `LiveHymn`, `LiveSong`, `LiveTicker`, `LiveTimer`, `Camera(name)`, current/next event, observable output state.
- **Per-audience:** `OutputLanguage`, visibility, aspect/profile, stage-private vs congregation-public fields.

A dynamic node is a *subscription contract*, not a baked string or cached screenshot. Moving the active Bible reference updates any scene that intentionally follows it; it does **not** force a scene Take or mutate an unrelated output. Camera nodes reference decoded streams as layers; actual media distribution stays in Rhema/MediaMTX and output renderer. This must not depend on the Avnac editing UI being open.

Publish design variants to existing NDI full-screen/lower third, Browser/OBS feeds, stage, signage and TV Receiver using Rhema's existing output system. Verify alpha/transparent lower-third mode for OBS, bilingual-safe area, 720p30 vs 1080p30 and only claim real 60fps after physical proof (#198/#208/#213).

## 5. MCP/AI as a safe drafting assistant

- Use Rhema's own versioned authenticated **MCP** bridge (#252), not a parallel unrestricted Avnac/Wails MCP server. Adapt upstream canvas actions into scoped `read templates`, `create/edit draft`, `insert layer`, `style`, `inspect preview`, `save revision`, `undo`, with validation and audited operator identity.
- AI can prepare a full editable service Run of Show (separate #252) and use an approved design to create lower thirds/sermon slides. AI must not automatically **Approve, Activate or Take to a public output**. Human preview, edit and approval remain mandatory.
- Respect service/asset permissions, Bible licensing, church private data, and offline local mode. Failing AI/service network access never blocks manual editing or Sunday presentation.

## 6. Canva decision and source provenance

Current product direction prioritizes an **embedded native Avnac engine**, **not** Canva integration. Treat the older `docs/rhema-studio/11-canva-connect-findings.md` and #34 as historical alternatives, not a mandatory development dependency. Keep generic media import/export available, including assets created externally in Canva, Figma or elsewhere. If Canva OAuth comes later, it is a separately approved optional integration.

**Owner says the installation is internal to the church and no application distribution is planned.** Record this as deployment intent. Still preserve original Rhema MIT copyright, Avnac GPLv3 license text and contributor notices if source is reused. **Important:** the GitHub repository is public; pushing copied GPL code to it itself makes that code publicly available and may trigger GPL notice/source/distribution obligations even if installed builds stay internal. Verify rights/provenance and document corresponding license terms before a code-import commit. This is a compact checklist, not a requirement to replace the approved editor with a different product.

## 7. Phased acceptance

1. **Engine spike:** inspect upstream source/license dependencies, isolate runtime entry points and run minimal 100-layer / image-text save-reopen renderer tests inside Rhema; original renderer still works.
2. **Single editor:** built-in/gallery template → editable copy → 3-page sermon announcement (text/images/gradient/QR) → save/reopen locally, reference same design in Library/Prepare. At no point does browsing/editing update output.
3. **Languages:** English-only; Yorùbá-only; EN+YO layout for Scripture and aligned hymns/choruses; output-specific renderers and graceful missing-second-language.
4. **Compositions:** real Pulpit WebRTC camera + bilingual Bible + title lower third in congregation; OBS independent English-only source/feed with correct transparency; Stage private timer/notes; one source update, no forced destination Take.
5. **Safety:** while scene is live, change a layer/background or Brand Kit draft; assert no on-air change until authorized scoped Take/Apply and receiver ack.
6. **MCP:** AI creates *editable* draft artboard, human approves, undo/redo; no AI direct Live mutation.
7. **Migration:** saved legacy slide, imported song/hymn, existing theme and both programs still work offline after upgrade, revert and backup/restore.

**Do not split document models per content type or ship an editor that only exports static PNGs and calls that dynamic-scene integration.**
