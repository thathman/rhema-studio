# Built-in look library (#299 UX15-3)

**Design → Library** holds ready-made looks to start from. They come with Rhema, need no network, and
were made for Rhema: no picture, template or font was copied from anywhere else.

## How it works

- A library look never changes and is never put on a screen itself.
- **Use** adds your own copy to your looks: a theme (Design → Themes), a lower-third style
  (Design → Lower thirds), or a scene (Production → Scenes). Nothing on the screens changes until you
  choose the copy for an output in its settings, or take the scene (ADR 0001: no look goes live by itself).
- **Use and edit** does the same and opens the copy to change; a camera scene opens in Production → Scenes.
- **Use with church colours** (themes, name bands, camera scenes) adds the copy in the Brand Kit's colours
  and fonts: the words in its text colour and body font; the reference, second language and verse numbers
  in its accent; the reference in its heading font; a name band's bar in the accent. The look's background
  and layout stay. Each colour must read at 4.5:1 on what the words sit on (the look's band, else its
  background, else, for a keyed look, the camera picture taken as dark); one that would not is left as the
  look has it, and the message says so. The copy's name ends with the church name. The library look,
  the built-in themes and every look a screen uses are never changed, and Brand Kit Apply never rewrites
  the copy. Until the Brand Kit has the church's colours, the button points to Design → Brand Kit. The
  ticker and stage looks are not offered: using one replaces the church's single look.
- The ticker and the stage display each have one look for the church. Using a ticker look replaces it,
  and a ticker running now keeps its look until you start it again. Using a stage look asks first,
  because stage screens show it straight away (the congregation never sees the stage display).
- Every copy (a theme, a name band, a camera scene, the ticker and stage looks) remembers which library look
  it came from. The card's **…** menu can **reset** a copy to the library look (its name stays). A copy on
  air cannot be reset: a theme an output or a scene on air uses, a name band showing now, a scene on an
  output, the ticker while it runs, the stage look while a stage screen is on. A reset scene gets its layers
  back where the template places them; its camera keeps its stream address and the looks it shows in stay.
- The heart marks a favourite on this computer; **Favourites** shows only those.
- Filters: layout (Full screen, Lower third, Ticker, Camera scene, Stage, **OBS overlay**), background
  (Dark, Light, Transparent), language and family. OBS overlay is worked out from the look: a lower third or
  ticker with a transparent background. Every look is 16:9; an Aspect filter appears once there are 9:16
  looks too.
- Each look's metadata also says its frame shape (`aspect`: 16:9 or 9:16) and its sound (`audio`: absent or
  `"silent"` for looks with no sound of their own, which is every look today, so they can sit over a feed
  carrying the service sound; `"own-sound"` for a look whose video plays sound).
- Language: **Yorùbá** keeps looks that read right in Yorùbá (their fonts carry the dotted letters and tone
  marks, and they have no English words built in: the tickers tagged NOTICES, UPDATES, THIS WEEK and
  NOTICE are English only); **English** keeps every look; **Both together** keeps looks that show two
  languages at once: themes with a second-language style (a bilingual verse or song slide gets its own
  block), the stage display and camera scenes whose look does. Name bands and tickers show one line of
  words, in whichever language you type. A look's `languages` metadata sets this when it is not the
  default.

A **look** is how words appear; a **scene** arranges layers (a camera, a live source) and names the look
each layer shows in; an **output** (a projector, an NDI sender, a browser feed) chooses its look or takes a
scene. The library adds looks and scenes; it never edits an output.

## Families and what each look is for

| Family | Full screen | Lower thirds (transparent) | Speaker name | Ticker | Camera scenes | Stage |
|---|---|---|---|---|---|---|
| **Church Classic**: book type, navy, gold | Scripture (centred page); Hymn (title above, second language in gold); Announcement | Scripture band; Hymn band | Name and title, gold rule | Notices crawl | Camera and scripture; Camera and hymn | Calm stage |
| **Broadcast Clean**: crisp keyed graphics for OBS | Scripture (left, sharp); Lyrics (bold, centred); Announcement | Scripture strip (full width); Lyrics strip (slim) | Name strip, teal bar, slides in | News crawl, teal tag | Camera and scripture; Camera and lyrics | |
| **Contemporary**: minimal and bold | Key line (scripture); Lyrics; Paper lyrics (light); Announcement (big title) | Scripture words; Lyrics words (no band, soft shadow) | Name pill (centred) | Still notices along the top, one at a time | Camera and scripture; Camera and lyrics | |
| **Warm Editorial**: paper and book type | Scripture page (light); Hymn page (light); Quiet moment (prayer, communion, memorial; dark); Notice page (light) | Scripture card; Hymn card (light cards) | Name card, brass rule | This week (slow crawl) | Camera and scripture; Camera and hymn | |
| **High Contrast**: large type, no motion | Scripture; Lyrics; Lyrics on white; Announcement | Scripture band; Lyrics band (solid black, wide margins) | Name band, comes on at once | Still notices, large | Camera and scripture; Camera and lyrics | Large confidence (bigger words, 5-minute warning) |
| **Seasonal**: understated | Easter morning (light); Christmas evening; Celebration | | Conference speaker | | | |

Lower thirds have a transparent background, as the built-in Lower Thirds theme does: on an NDI output
with alpha or an OBS browser feed the camera shows through everywhere but the band. The camera scenes are
a full-frame camera layer with the family's lower-third look over it; choose the camera by name in
Production → Scenes.

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
- Not yet: 9:16 looks (the renderer and NDI are 16:9 throughout), and church colours on the ticker and stage looks.

## Starter looks in setup (#298)

Setup step 3 offers the five main families as **starter looks** (`src/lib/starter-pack.ts`; Seasonal is a
handful of extras, not a pack). A family's pack is its Bible and lyrics full screen, announcement, Bible and
lyrics lower thirds, name band, ticker, the two camera scenes and, where the family has one, its stage look.
Choosing a family only shows it: the copies drawn in the Brand Kit's colours (as last applied; the library
look when the kit still has Rhema's starting colours) and, in words, what Apply would add and which outputs
it would change. **Apply…** asks first. Then the looks are copied (the camera scenes show in the copied
bands), the ticker look replaced (a running ticker keeps its look until started again), the stage look
replaced only when no stage screen is on, and each congregation output that is **off** gets the pack as its
looks: full-screen outputs the full-screen looks (Bible, songs and hymns, slides), keyed ones (their look is
transparent) the bands. Outputs that are on, stage and signage outputs are never changed; which outputs are
on is checked again when Apply is pressed (ADR 0001: Draft until Apply, nothing goes live by itself).
- Ready-made feeds (Production → Screens → Add a ready-made feed) are in `src/lib/feed-presets.ts`: each
  makes a new output with its own id, `shows`, a built-in look (Classic Dark full screen, Lower Thirds
  keyed) and its NDI source name, off, and refuses a name an output already has.
