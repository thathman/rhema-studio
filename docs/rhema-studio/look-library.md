# Built-in look library (#299 UX15-3)

**Design → Library** holds ready-made looks to start from. They come with Rhema, need no network, and
were made for Rhema: no picture, template or font was copied from anywhere else.

## How it works

- A library look never changes and is never put on a screen itself.
- **Use** adds your own copy to your looks: a theme (Design → Themes), a lower-third style
  (Design → Lower thirds), or a scene (Production → Programs). Nothing on the screens changes until you
  choose the copy for an output in its settings, or take the scene (ADR 0001: no look goes live by itself).
- **Use and edit** does the same and opens the copy to change.
- The ticker and the stage display each have one look for the church. Using a ticker look replaces it,
  and a ticker running now keeps its look until you start it again. Using a stage look asks first,
  because stage screens show it straight away (the congregation never sees the stage display).
- A theme copy remembers which library look it came from. The card's **…** menu can **reset** a copy to
  the library look (its name stays); a copy an output or a scene on air uses cannot be reset.
- The heart marks a favourite on this computer; **Favourites** shows only those.
- Filters: layout (Full screen, Lower third, Ticker, Camera scene, Stage), background (Dark, Light,
  Transparent) and family. Every look is 16:9 and shows two languages when the content has them.

A **look** is how words appear; a **scene** arranges layers (a camera, a live source) and names the look
each layer shows in; an **output** (a projector, an NDI sender, a browser feed) chooses its look or takes a
scene. The library adds looks and scenes; it never edits an output.

## Families and what each look is for

| Family | Full screen | Lower thirds (transparent) | Speaker name | Ticker | Camera scenes | Stage |
|---|---|---|---|---|---|---|
| **Church Classic**: book type, navy, gold | Scripture (centred page); Hymn (title above, second language in gold) | Scripture band; Hymn band | Name and title, gold rule | Notices crawl | Camera and scripture; Camera and hymn | Calm stage |
| **Broadcast Clean**: crisp keyed graphics for OBS | Scripture (left, sharp); Lyrics (bold, centred) | Scripture strip (full width); Lyrics strip (slim) | Name strip, teal bar, slides in | News crawl, teal tag | Camera and scripture; Camera and lyrics | |
| **Contemporary**: minimal and bold | Key line (scripture); Lyrics; Paper lyrics (light) | Scripture words; Lyrics words (no band, soft shadow) | Name pill (centred) | Still notices along the top, one at a time | Camera and scripture; Camera and lyrics | |
| **Warm Editorial**: paper and book type | Scripture page (light); Hymn page (light); Quiet moment (prayer, communion, memorial; dark) | Scripture card; Hymn card (light cards) | Name card, brass rule | This week (slow crawl) | Camera and scripture; Camera and hymn | |
| **High Contrast**: large type, no motion | Scripture; Lyrics; Lyrics on white | Scripture band; Lyrics band (solid black, wide margins) | Name band, comes on at once | Still notices, large | Camera and scripture; Camera and lyrics | Large confidence (bigger words, 5-minute warning) |
| **Seasonal**: understated | Easter morning (light); Christmas evening; Celebration | | Conference speaker | | | |

Lower thirds have a transparent background, as the built-in Lower Thirds theme does: on an NDI output
with alpha or an OBS browser feed the camera shows through everywhere but the band. The camera scenes are
a full-frame camera layer with the family's lower-third look over it; set the camera's stream address in
Production → Programs.

## Previews

Each card is drawn by the same code the outputs use (themes, lower thirds, ticker, scenes, stage display),
with public-domain sample words: Psalm 100:1 (KJV) with the Yorùbá line "Ẹ hó ìhó ayọ̀ sí Olúwa, gbogbo
ilẹ̀.", the first lines of "Amazing Grace" (John Newton, 1779) with the Yorùbá lines already used by the
Theme Designer, a made-up speaker name and church notices.

## Assets, fonts and licences

- **Pictures, patterns, icons:** none. Every look is colours, type and layout written in
  `src/lib/look-library-data.ts`; all original to Rhema Studio. A test checks that no look carries a
  picture or a web address.
- **Fonts:** only the fonts Rhema already bundles (npm `@fontsource` packages, licence files in each
  package), all under the SIL Open Font License 1.1, which allows bundling and redistribution:
  - Source Serif 4 (Adobe), `@fontsource-variable/source-serif-4`
  - Inter (Rasmus Andersson), `@fontsource-variable/inter`
  - Geist and Geist Mono (Vercel), `@fontsource-variable/geist`, `@fontsource/geist-mono`
  - IBM Plex Sans (IBM), `@fontsource/ibm-plex-sans`

  Source Serif 4, Inter and IBM Plex Sans carry the Latin Extended and Vietnamese ranges that hold Yorùbá's
  dotted letters and tone marks. No new font or asset was added for the library.
- **Lyrics and scripture:** only the public-domain samples above; no copyrighted song text or background.

## For developers

- Ids (`look-…`) are stable: a copy stores `libraryLookId`, so never rename or reuse one; add new looks.
- The four built-in themes (`builtin-classic-dark`, `builtin-modern-light`, `builtin-broadcast-overlay`,
  `builtin-banner-split`) are not part of the library and are unchanged.
- `src/lib/look-library.test.ts` checks that every look normalizes unchanged, uses bundled fonts only, and
  that Use adds copies with new ids and leaves outputs as they were.
- Not yet: 9:16 looks, a language filter, Brand Kit colours applied to library looks, and Design →
  "Used on" (UX15-4).
