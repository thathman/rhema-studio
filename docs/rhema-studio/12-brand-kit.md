# 12 — Church Brand Kit and native announcement templates (CV-004, CV-005)

Status: **design only. Not implemented.** Issue #35. No Canva dependency; this is
what makes announcements look like the church's own without any design tool.

## 1. Goal

A volunteer types "Youth meeting — Friday 6 pm" and the screen shows it in the
church's colours, with the church's logo and fonts, matching the Scripture and
lyric screens — in under a minute, offline.

## 2. What exists already

- Themes (`BroadcastTheme`): background, text box, verse/reference styles, dual-language
  styles, image fills. The designer edits them; outputs pick one each.
- Custom slides (SV-001): title + lines, drawn in the active theme.
- Media library (MD-001): hash-identified pictures; background pictures per item (MD-003).
- Quick screens (MD-005), bilingual.

So "a brand" is mostly a *consistent set of theme values plus a logo*. The kit is a
small record that generates and keeps those values in sync across themes.

## 3. Data model

`brand_kit` is one JSON document in the settings store (not `studio.db`; it is
configuration, not service content), with a `revision` for conflict safety when
collaboration (Milestone 7) arrives:

```ts
interface BrandKit {
  version: 1
  churchName: string
  logoMediaId: string | null           // a picture from the media library
  colors: { primary: string; accent: string; text: string; background: string }
  fonts: { heading: string; body: string }   // families available offline (bundled or installed)
  logo: { corner: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "none"; size: 6 | 8 | 10 } // % of height
  variants: Array<{ id: string; name: string; colors?: Partial<BrandKit["colors"]>; logoMediaId?: string | null }> // Youth, Children's, Evening
}
```

## 4. How the kit reaches the screen

1. **Theme generation.** "Apply brand" creates (or updates, keeping ids) three themes
   derived from the built-ins: *Brand Scripture*, *Brand Lyrics*, *Brand Announcements*.
   Each takes `colors`, `fonts` and the logo corner. Themes the church edited by hand are
   never overwritten; the generated ones carry `brandKitManaged: true` and a small
   "managed by Brand Kit" badge in the designer.
2. **Logo element.** `BroadcastTheme.logo?: { mediaId, corner, size, opacity }` drawn
   by the renderer after the background and before text, from the media cache (data URL,
   like background pictures). Hidden automatically on transparent (OBS) themes unless
   `showOnTransparent`.
3. **Announcement template** = a custom slide kind with structured fields:
   `{ title, date?, time?, place?, body, variantId? }` rendered as title (heading font,
   accent colour), a meta line (date · time · place) and body lines. Stored as
   `kind='slide'` with `payload.template = "announcement"` so older builds still show it
   as a plain slide (title + lines) — no new item kind, no migration.
4. **Where it lives in the UI.** More → Church brand (logo, colours, fonts, variants,
   Apply). Prepare → Slides gains a second tab "Announcement" with the structured fields
   and a variant select; the preview follows as you type.

## 5. Rules

- Everything is local: fonts must be bundled or installed; the kit records the family
  name and Home warns when it is not available ("Brand font Poppins is not installed").
- Applying the brand never changes what is live; it changes themes, and outputs pick
  up a theme change the way they do today.
- Colour contrast: the generated themes use `backgroundScrimAlpha` and a minimum
  contrast check (WCAG 4.5:1 for body text) with an automatic fallback to the kit's
  `text` colour when a variant's accent fails.
- Canva later (CV-003): an exported design becomes a picture; the kit's logo/colours
  are what native templates use when no Canva design exists.

## 6. Tests to write first

1. `brandKit → themes`: deterministic generation; re-applying with a changed primary
   colour updates managed themes and leaves hand-edited ones alone.
2. Contrast fallback: a low-contrast accent is replaced for body text.
3. Announcement payload round trip through the service store; an older-build reader
   sees title + lines.
4. Renderer: logo drawn in the chosen corner at the chosen size (data-level test on the
   layout rect).

## 7. Sequencing

1. Logo element in themes + renderer (small, visible). 2. Brand kit record + More →
Church brand + Apply. 3. Announcement template tab. 4. Variants. 5. Font availability
warning on Home.
