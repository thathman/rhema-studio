import type { BroadcastTheme, VerseTextStyle } from "@/types/broadcast"
import type { LowerThirdStyle, StageStyle, TickerStyle } from "@/types/broadcast-output"
import type { LibraryLook, LookFamily, SceneTemplateLayer } from "@/lib/look-library"

/**
 * The built-in look library (#299 UX15-3): original looks made for Rhema,
 * using only the fonts bundled with the app. Nothing here is a picture or
 * someone else's template. Ids are stable (a copy remembers which look it
 * came from, for Reset), so never rename one; add new looks instead. A look with
 * English words built in (a ticker's "NOTICES" tag) is marked `languages: ["en"]`.
 */

export const LOOK_FAMILIES: readonly LookFamily[] = [
  { id: "church-classic", name: "Church Classic", description: "Traditional scripture and hymns: book type, deep navy and a touch of gold." },
  { id: "broadcast-clean", name: "Broadcast Clean", description: "Crisp, keyed graphics for the stream and the sanctuary camera." },
  { id: "contemporary", name: "Contemporary", description: "Minimal, bold lyrics and scripture for modern worship and youth services." },
  { id: "warm-editorial", name: "Warm Editorial", description: "Paper tones and book type for scripture, prayer and quiet moments." },
  { id: "high-contrast", name: "High Contrast", description: "Large type, strong contrast and no motion: easiest to read from the back and with low vision." },
  { id: "seasonal", name: "Seasonal", description: "A few understated looks for Easter, Christmas and celebrations." },
]

// Bundled fonts (see src/lib/fonts.ts): all SIL Open Font License 1.1.
const SERIF = "Source Serif 4 Variable"
const GEIST = "Geist Variable"
const INTER = "Inter Variable"
const PLEX = "IBM Plex Sans"
const MONO = "Geist Mono"

type Reference = BroadcastTheme["reference"]
type Layout = BroadcastTheme["layout"]

const words = (fontFamily: string, fontSize: number, fontWeight: number, color: string, more: Partial<VerseTextStyle> = {}): VerseTextStyle => ({
  fontFamily, fontSize, fontWeight, color, horizontalAlign: "center", verticalAlign: "top", textTransform: "none", textDecoration: "none", lineHeight: 1.45, letterSpacing: 0, shadow: null, outline: null, ...more,
})
const reference = (fontFamily: string, fontSize: number, fontWeight: number, color: string, more: Partial<Reference> = {}): Reference => ({
  fontFamily, fontSize, fontWeight, color, horizontalAlign: "center", verticalAlign: "top", textTransform: "none", textDecoration: "none", uppercase: false, letterSpacing: 0, position: "above", ...more,
})
const solid = (color: string): BroadcastTheme["background"] => ({ type: "solid", color, gradient: null, image: null })
// Keyed looks: nothing behind the band, so OBS and NDI receivers see the camera through it.
const TRANSPARENT: BroadcastTheme["background"] = { type: "transparent", color: "transparent", gradient: null, image: null }
const NO_BOX: BroadcastTheme["textBox"] = { enabled: false, color: "#000000", opacity: 0, borderRadius: 0, padding: 0, image: null }
const box = (color: string, opacity: number, borderRadius: number, padding: number): BroadcastTheme["textBox"] => ({ enabled: true, color, opacity, borderRadius, padding, image: null })
const SOFT_SHADOW = { color: "rgba(0,0,0,0.85)", blur: 10, x: 0, y: 2 }

/** A full-screen text area with generous safe margins. */
const fullFrame = (textAlign: Layout["textAlign"], side = 110, top = 80): Layout => ({
  anchor: "center", offsetX: 0, offsetY: 0, padding: { top, right: side, bottom: top, left: side }, textAlign,
  backgroundWidth: 100, backgroundHeight: 100, textAreaWidth: 88, textAreaHeight: 84, referenceGap: 30, languageGap: 34, mode: "stacked",
})
/** A band along the bottom: `height` and `width` in % of the frame, lifted `lift` px off the bottom edge. */
const band = (textAlign: Layout["textAlign"], height: number, width = 100, lift = 0): Layout => ({
  anchor: "bottom-center", offsetX: 0, offsetY: -lift, padding: { top: 26, right: 56, bottom: 26, left: 56 }, textAlign,
  backgroundWidth: 100, backgroundHeight: 100, textAreaWidth: width, textAreaHeight: height, referenceGap: 14, languageGap: 16, mode: "stacked",
})

function theme(id: string, name: string, p: Pick<BroadcastTheme, "background" | "verseText" | "reference" | "layout"> & Partial<BroadcastTheme>): BroadcastTheme {
  return {
    id, name, builtin: true, pinned: false, createdAt: 0, updatedAt: 0, resolution: { width: 1920, height: 1080 },
    textBox: NO_BOX,
    verseNumbers: { visible: true, fontSize: 22, color: p.reference.color, superscript: true },
    transition: { type: "fade", duration: 400, easing: "ease-in-out", direction: "up" },
    ...p,
  }
}

const speaker = (id: string, name: string, p: Omit<LowerThirdStyle, "id" | "name">): LowerThirdStyle => ({ id, name, ...p })
const ticker = (p: TickerStyle): TickerStyle => p
const stage = (p: StageStyle): StageStyle => p

/** Camera full frame with a keyed strip (a lower-third look) over it. */
const cameraWith = (shows: "bible" | "lyrics", lookId: string): SceneTemplateLayer[] => [
  { kind: "camera", name: "Camera", box: { x: 0, y: 0, w: 100, h: 100 } },
  shows === "bible"
    ? { kind: "feed", name: "Bible", shows: ["bible"], box: { x: 0, y: 0, w: 100, h: 100 }, lookId }
    : { kind: "feed", name: "Lyrics", shows: ["song", "hymn"], box: { x: 0, y: 0, w: 100, h: 100 }, lookId },
]

/** No verse numbers: an announcement slide has a title and lines, not verses. */
const NO_NUMBERS = (color: string): BroadcastTheme["verseNumbers"] => ({ visible: false, fontSize: 22, color, superscript: true })

// ── Church Classic ───────────────────────────────────────────────────────
const CC = { ink: "#14202b", paper: "#f6f1e7", gold: "#c9a86a" }
const classic: LibraryLook[] = [
  { kind: "theme", id: "look-classic-bible-full", family: "church-classic", name: "Classic · Scripture", purpose: "The Bible reading on the main screens, centred like a printed page.", layout: "fullscreen", content: "bible", background: "dark", aspect: "16:9",
    theme: theme("look-classic-bible-full", "Classic · Scripture", {
      background: { type: "gradient", color: CC.ink, gradient: { type: "radial", angle: 0, stops: [{ color: "#1f2d3a", position: 0 }, { color: "#0f171f", position: 100 }] }, image: null },
      verseText: words(SERIF, 70, 400, CC.paper, { lineHeight: 1.5 }),
      secondaryVerseText: words(SERIF, 60, 400, CC.gold, { lineHeight: 1.45 }),
      reference: reference(SERIF, 40, 600, CC.gold, { uppercase: true, letterSpacing: 3 }),
      layout: fullFrame("center"),
      transition: { type: "fade", duration: 500, easing: "ease-in-out", direction: "up" },
    }) },
  { kind: "theme", id: "look-classic-bible-l3", family: "church-classic", name: "Classic · Scripture band", purpose: "The verse in a navy band over the camera, for the stream or a keyed sanctuary feed.", layout: "lower-third", content: "bible", background: "transparent", aspect: "16:9",
    theme: theme("look-classic-bible-l3", "Classic · Scripture band", {
      background: TRANSPARENT,
      textBox: box(CC.ink, 0.88, 6, 22),
      verseText: words(SERIF, 50, 400, CC.paper, { horizontalAlign: "left", lineHeight: 1.35 }),
      secondaryVerseText: words(SERIF, 42, 400, CC.gold, { horizontalAlign: "left", lineHeight: 1.3 }),
      reference: reference(PLEX, 28, 600, CC.gold, { horizontalAlign: "left", uppercase: true, letterSpacing: 2 }),
      layout: band("left", 30, 92, 40),
      transition: { type: "fade", duration: 300, easing: "ease-in-out", direction: "up" },
    }) },
  { kind: "theme", id: "look-classic-hymn-full", family: "church-classic", name: "Classic · Hymn", purpose: "Hymns and songs with the title above, the second language in gold beneath.", layout: "fullscreen", content: "lyrics", background: "dark", aspect: "16:9",
    theme: theme("look-classic-hymn-full", "Classic · Hymn", {
      background: solid("#16222d"),
      verseText: words(SERIF, 66, 500, CC.paper, { lineHeight: 1.4 }),
      secondaryVerseText: words(SERIF, 56, 400, CC.gold, { lineHeight: 1.35 }),
      verseNumbers: { visible: true, fontSize: 24, color: CC.gold, superscript: false },
      reference: reference(SERIF, 34, 600, CC.gold, { letterSpacing: 1 }),
      layout: fullFrame("center"),
    }) },
  { kind: "theme", id: "look-classic-hymn-l3", family: "church-classic", name: "Classic · Hymn band", purpose: "Hymn lines in a navy band for the camera feed.", layout: "lower-third", content: "lyrics", background: "transparent", aspect: "16:9",
    theme: theme("look-classic-hymn-l3", "Classic · Hymn band", {
      background: TRANSPARENT,
      textBox: box(CC.ink, 0.88, 6, 20),
      verseText: words(SERIF, 48, 500, CC.paper, { lineHeight: 1.3 }),
      secondaryVerseText: words(SERIF, 40, 400, CC.gold, { lineHeight: 1.3 }),
      reference: reference(PLEX, 26, 600, CC.gold, { uppercase: true, letterSpacing: 2 }),
      layout: band("center", 30, 92, 40),
    }) },
  { kind: "theme", id: "look-classic-announcement", family: "church-classic", name: "Classic · Announcement", purpose: "A notice slide for the main screens: the title in gold above, the details beneath.", layout: "fullscreen", content: "announcements", background: "dark", aspect: "16:9",
    theme: theme("look-classic-announcement", "Classic · Announcement", {
      background: solid("#16222d"),
      verseText: words(SERIF, 56, 400, CC.paper, { lineHeight: 1.45 }),
      secondaryVerseText: words(SERIF, 48, 400, CC.gold, { lineHeight: 1.4 }),
      verseNumbers: NO_NUMBERS(CC.gold),
      reference: reference(SERIF, 64, 600, CC.gold, { letterSpacing: 1 }),
      layout: fullFrame("center"),
    }) },
  { kind: "lower-third", id: "look-classic-speaker", family: "church-classic", name: "Classic · Name and title", purpose: "The preacher's or reader's name with a gold rule.", layout: "lower-third", content: "speaker", background: "transparent", aspect: "16:9",
    style: speaker("look-classic-speaker", "Classic · Name and title", {
      align: "left", margin: 6, bottom: 9, width: 0, height: 13, fontFamily: SERIF,
      line1: { size: 38, color: CC.paper, weight: 600, uppercase: false }, line2: { size: 24, color: CC.gold, weight: 500 },
      background: { kind: "color", color: CC.ink, opacity: 0.9, mediaId: null }, radius: 4, accent: { enabled: true, color: CC.gold, width: 6 }, animation: "fade",
    }) },
  { kind: "ticker", id: "look-classic-ticker", family: "church-classic", name: "Classic · Notices", purpose: "Church notices crawling along the bottom in navy and gold.", layout: "ticker", content: "announcements", background: "transparent", aspect: "16:9", languages: ["en"],
    style: ticker({ position: "bottom", height: 7, speed: 120, fontFamily: PLEX, size: 48, color: CC.paper, weight: 500, background: { kind: "color", color: CC.ink, opacity: 0.95, mediaId: null }, label: "NOTICES", labelColor: CC.ink, labelBackground: CC.gold, separator: "•", direction: "left", motion: "crawl", pageSeconds: 6 }) },
  { kind: "scene", id: "look-classic-scene-bible", family: "church-classic", name: "Classic · Camera and scripture", purpose: "A camera full frame with the scripture band over it.", layout: "scene", content: "bible", background: "dark", aspect: "16:9",
    scene: { background: "#000000", layers: cameraWith("bible", "look-classic-bible-l3") } },
  { kind: "scene", id: "look-classic-scene-lyrics", family: "church-classic", name: "Classic · Camera and hymn", purpose: "A camera full frame with the hymn band over it.", layout: "scene", content: "lyrics", background: "dark", aspect: "16:9",
    scene: { background: "#000000", layers: cameraWith("lyrics", "look-classic-hymn-l3") } },
  { kind: "stage", id: "look-classic-stage", family: "church-classic", name: "Classic · Calm stage", purpose: "A calm stage display in navy and paper tones; every part shown.", layout: "stage", content: "stage", background: "dark", aspect: "16:9",
    style: stage({ background: "#101820", words: CC.paper, wordsScale: 1, showTimer: true, showNext: true, showNote: true, showBand: true, showFinish: true, warnAtMinutes: 5, warnWhenOver: true }) },
]

// ── Broadcast Clean ──────────────────────────────────────────────────────
const BC = { slate: "#0e1216", white: "#ffffff", teal: "#7fcfc4", rule: "#3fa79a" }
const clean: LibraryLook[] = [
  { kind: "theme", id: "look-clean-bible-full", family: "broadcast-clean", name: "Clean · Scripture", purpose: "Plain, sharp scripture for a projector or a full-frame stream graphic.", layout: "fullscreen", content: "bible", background: "dark", aspect: "16:9",
    theme: theme("look-clean-bible-full", "Clean · Scripture", {
      background: solid("#101418"),
      verseText: words(INTER, 64, 500, BC.white, { horizontalAlign: "left", lineHeight: 1.45 }),
      secondaryVerseText: words(INTER, 54, 400, BC.teal, { horizontalAlign: "left", lineHeight: 1.4 }),
      reference: reference(INTER, 34, 600, BC.teal, { horizontalAlign: "left", uppercase: true, letterSpacing: 2 }),
      layout: fullFrame("left", 140),
    }) },
  { kind: "theme", id: "look-clean-bible-l3", family: "broadcast-clean", name: "Clean · Scripture strip", purpose: "A full-width keyed strip for OBS: the verse in white, the reference in teal.", layout: "lower-third", content: "bible", background: "transparent", aspect: "16:9",
    theme: theme("look-clean-bible-l3", "Clean · Scripture strip", {
      background: TRANSPARENT,
      textBox: box(BC.slate, 0.84, 0, 22),
      verseText: words(INTER, 46, 500, BC.white, { horizontalAlign: "left", lineHeight: 1.35 }),
      secondaryVerseText: words(INTER, 40, 400, BC.teal, { horizontalAlign: "left", lineHeight: 1.3 }),
      reference: reference(INTER, 26, 700, BC.teal, { horizontalAlign: "left", uppercase: true, letterSpacing: 2 }),
      layout: band("left", 28),
      transition: { type: "slide", duration: 300, easing: "ease-out", direction: "up" },
    }) },
  { kind: "theme", id: "look-clean-lyrics-full", family: "broadcast-clean", name: "Clean · Lyrics", purpose: "Song and hymn words, centred and bold, for the room.", layout: "fullscreen", content: "lyrics", background: "dark", aspect: "16:9",
    theme: theme("look-clean-lyrics-full", "Clean · Lyrics", {
      background: solid("#0f1317"),
      verseText: words(INTER, 66, 600, BC.white, { lineHeight: 1.35 }),
      secondaryVerseText: words(INTER, 54, 500, BC.teal, { lineHeight: 1.3 }),
      verseNumbers: { visible: false, fontSize: 22, color: BC.teal, superscript: true },
      reference: reference(INTER, 28, 600, "#9aa7ad", { uppercase: true, letterSpacing: 2, position: "below" }),
      layout: fullFrame("center"),
    }) },
  { kind: "theme", id: "look-clean-lyrics-l3", family: "broadcast-clean", name: "Clean · Lyrics strip", purpose: "Lyrics on a slim keyed strip so the stream still sees the worship team.", layout: "lower-third", content: "lyrics", background: "transparent", aspect: "16:9",
    theme: theme("look-clean-lyrics-l3", "Clean · Lyrics strip", {
      background: TRANSPARENT,
      textBox: box(BC.slate, 0.78, 0, 18),
      verseText: words(INTER, 44, 600, BC.white, { lineHeight: 1.3, shadow: SOFT_SHADOW }),
      secondaryVerseText: words(INTER, 38, 500, BC.teal, { lineHeight: 1.25 }),
      verseNumbers: { visible: false, fontSize: 22, color: BC.teal, superscript: true },
      reference: reference(INTER, 22, 600, "#b8c4c9", { uppercase: true, letterSpacing: 2, position: "below" }),
      layout: band("center", 26),
    }) },
  { kind: "theme", id: "look-clean-announcement", family: "broadcast-clean", name: "Clean · Announcement", purpose: "A plain notice slide: a bold title in teal, the details in white, set to the left.", layout: "fullscreen", content: "announcements", background: "dark", aspect: "16:9",
    theme: theme("look-clean-announcement", "Clean · Announcement", {
      background: solid("#101418"),
      verseText: words(INTER, 54, 500, BC.white, { horizontalAlign: "left", lineHeight: 1.45 }),
      secondaryVerseText: words(INTER, 46, 400, BC.teal, { horizontalAlign: "left", lineHeight: 1.4 }),
      verseNumbers: NO_NUMBERS(BC.teal),
      reference: reference(INTER, 62, 700, BC.teal, { horizontalAlign: "left" }),
      layout: fullFrame("left", 140),
    }) },
  { kind: "lower-third", id: "look-clean-speaker", family: "broadcast-clean", name: "Clean · Name strip", purpose: "Speaker's name and role with a teal bar, slides in for the stream.", layout: "lower-third", content: "speaker", background: "transparent", aspect: "16:9",
    style: speaker("look-clean-speaker", "Clean · Name strip", {
      align: "left", margin: 5, bottom: 10, width: 0, height: 12, fontFamily: INTER,
      line1: { size: 36, color: BC.white, weight: 700, uppercase: true }, line2: { size: 24, color: "#cfe9e5", weight: 400 },
      background: { kind: "color", color: BC.slate, opacity: 0.88, mediaId: null }, radius: 0, accent: { enabled: true, color: BC.rule, width: 10 }, animation: "slide",
    }) },
  { kind: "ticker", id: "look-clean-ticker", family: "broadcast-clean", name: "Clean · News crawl", purpose: "A news-style crawl with a teal tag, for the stream.", layout: "ticker", content: "announcements", background: "transparent", aspect: "16:9", languages: ["en"],
    style: ticker({ position: "bottom", height: 6, speed: 150, fontFamily: INTER, size: 50, color: BC.white, weight: 600, background: { kind: "color", color: BC.slate, opacity: 0.92, mediaId: null }, label: "UPDATES", labelColor: BC.white, labelBackground: "#256d68", separator: "|", direction: "left", motion: "crawl", pageSeconds: 6 }) },
  { kind: "scene", id: "look-clean-scene-bible", family: "broadcast-clean", name: "Clean · Camera and scripture", purpose: "The sanctuary camera with the scripture strip keyed over it.", layout: "scene", content: "bible", background: "dark", aspect: "16:9",
    scene: { background: "#000000", layers: cameraWith("bible", "look-clean-bible-l3") } },
  { kind: "scene", id: "look-clean-scene-lyrics", family: "broadcast-clean", name: "Clean · Camera and lyrics", purpose: "The worship camera with the lyrics strip keyed over it.", layout: "scene", content: "lyrics", background: "dark", aspect: "16:9",
    scene: { background: "#000000", layers: cameraWith("lyrics", "look-clean-lyrics-l3") } },
]

// ── Contemporary ─────────────────────────────────────────────────────────
const CT = { char: "#161616", sand: "#ece6da", amber: "#f0a35e", paper: "#efece6", ink: "#1d1d1b" }
const contemporary: LibraryLook[] = [
  { kind: "theme", id: "look-contemporary-bible-full", family: "contemporary", name: "Contemporary · Key line", purpose: "Scripture as one strong line, the reference small underneath.", layout: "fullscreen", content: "bible", background: "dark", aspect: "16:9",
    theme: theme("look-contemporary-bible-full", "Contemporary · Key line", {
      background: solid(CT.char),
      verseText: words(GEIST, 72, 700, CT.sand, { horizontalAlign: "left", lineHeight: 1.25, letterSpacing: -1 }),
      secondaryVerseText: words(GEIST, 58, 500, CT.amber, { horizontalAlign: "left", lineHeight: 1.25 }),
      verseNumbers: { visible: false, fontSize: 22, color: CT.amber, superscript: true },
      reference: reference(MONO, 28, 500, CT.amber, { horizontalAlign: "left", uppercase: true, letterSpacing: 3, position: "below" }),
      layout: fullFrame("left", 150, 110),
    }) },
  { kind: "theme", id: "look-contemporary-lyrics-full", family: "contemporary", name: "Contemporary · Lyrics", purpose: "Big, tight lyrics for modern worship.", layout: "fullscreen", content: "lyrics", background: "dark", aspect: "16:9",
    theme: theme("look-contemporary-lyrics-full", "Contemporary · Lyrics", {
      background: solid("#121212"),
      verseText: words(GEIST, 78, 700, "#ffffff", { lineHeight: 1.2, letterSpacing: -1 }),
      secondaryVerseText: words(GEIST, 60, 500, CT.amber, { lineHeight: 1.2 }),
      verseNumbers: { visible: false, fontSize: 22, color: CT.amber, superscript: true },
      reference: reference(MONO, 24, 500, "#8a8a8a", { uppercase: true, letterSpacing: 3, position: "below" }),
      layout: fullFrame("center"),
    }) },
  { kind: "theme", id: "look-contemporary-lyrics-paper", family: "contemporary", name: "Contemporary · Paper lyrics", purpose: "The same lyrics on a light paper ground, for bright rooms and daytime services.", layout: "fullscreen", content: "lyrics", background: "light", aspect: "16:9",
    theme: theme("look-contemporary-lyrics-paper", "Contemporary · Paper lyrics", {
      background: solid(CT.paper),
      verseText: words(GEIST, 76, 700, CT.ink, { lineHeight: 1.2, letterSpacing: -1 }),
      secondaryVerseText: words(GEIST, 58, 500, "#9a5a1e", { lineHeight: 1.2 }),
      verseNumbers: { visible: false, fontSize: 22, color: "#9a5a1e", superscript: true },
      reference: reference(MONO, 24, 500, "#6b6760", { uppercase: true, letterSpacing: 3, position: "below" }),
      layout: fullFrame("center"),
    }) },
  { kind: "theme", id: "look-contemporary-bible-l3", family: "contemporary", name: "Contemporary · Scripture words", purpose: "The verse as words alone over the camera, no band: a soft shadow keeps it readable.", layout: "lower-third", content: "bible", background: "transparent", aspect: "16:9",
    theme: theme("look-contemporary-bible-l3", "Contemporary · Scripture words", {
      background: TRANSPARENT,
      verseText: words(GEIST, 48, 700, "#ffffff", { lineHeight: 1.25, shadow: SOFT_SHADOW, outline: { color: "#000000", width: 2 } }),
      secondaryVerseText: words(GEIST, 40, 500, "#ffe2c4", { lineHeight: 1.25, shadow: SOFT_SHADOW }),
      verseNumbers: { visible: false, fontSize: 22, color: CT.amber, superscript: true },
      reference: reference(MONO, 26, 600, "#ffd9b0", { uppercase: true, letterSpacing: 3, position: "below" }),
      layout: band("center", 30, 90, 30),
    }) },
  { kind: "theme", id: "look-contemporary-lyrics-l3", family: "contemporary", name: "Contemporary · Lyrics words", purpose: "Lyrics as words alone at the bottom of the camera picture.", layout: "lower-third", content: "lyrics", background: "transparent", aspect: "16:9",
    theme: theme("look-contemporary-lyrics-l3", "Contemporary · Lyrics words", {
      background: TRANSPARENT,
      verseText: words(GEIST, 50, 700, "#ffffff", { lineHeight: 1.2, shadow: SOFT_SHADOW, outline: { color: "#000000", width: 2 } }),
      secondaryVerseText: words(GEIST, 40, 500, "#ffe2c4", { lineHeight: 1.2, shadow: SOFT_SHADOW }),
      verseNumbers: { visible: false, fontSize: 22, color: CT.amber, superscript: true },
      reference: reference(MONO, 22, 500, "#e6e6e6", { uppercase: true, letterSpacing: 3, position: "below", horizontalAlign: "center" }),
      layout: band("center", 26, 90, 30),
    }) },
  { kind: "theme", id: "look-contemporary-announcement", family: "contemporary", name: "Contemporary · Announcement", purpose: "A big, tight title with the details small beneath: youth nights, events, sign-ups.", layout: "fullscreen", content: "announcements", background: "dark", aspect: "16:9",
    theme: theme("look-contemporary-announcement", "Contemporary · Announcement", {
      background: solid(CT.char),
      verseText: words(GEIST, 50, 500, CT.sand, { horizontalAlign: "left", lineHeight: 1.35 }),
      secondaryVerseText: words(GEIST, 44, 500, CT.amber, { horizontalAlign: "left", lineHeight: 1.3 }),
      verseNumbers: NO_NUMBERS(CT.amber),
      reference: reference(GEIST, 78, 700, "#ffffff", { horizontalAlign: "left", letterSpacing: -1 }),
      layout: fullFrame("left", 150, 110),
    }) },
  { kind: "lower-third", id: "look-contemporary-speaker", family: "contemporary", name: "Contemporary · Name pill", purpose: "A centred, rounded name tag for youth nights and guest speakers.", layout: "lower-third", content: "speaker", background: "transparent", aspect: "16:9",
    style: speaker("look-contemporary-speaker", "Contemporary · Name pill", {
      align: "center", margin: 6, bottom: 8, width: 0, height: 12, fontFamily: GEIST,
      line1: { size: 38, color: "#ffffff", weight: 700, uppercase: false }, line2: { size: 22, color: CT.amber, weight: 500 },
      background: { kind: "color", color: CT.char, opacity: 0.88, mediaId: null }, radius: 50, accent: { enabled: false, color: CT.amber, width: 6 }, animation: "fade",
    }) },
  { kind: "ticker", id: "look-contemporary-ticker", family: "contemporary", name: "Contemporary · Still notices", purpose: "One notice at a time, still, along the top: no crawl to chase.", layout: "ticker", content: "announcements", background: "transparent", aspect: "16:9",
    style: ticker({ position: "top", height: 6, speed: 140, fontFamily: GEIST, size: 48, color: "#ffffff", weight: 600, background: { kind: "color", color: CT.char, opacity: 0.9, mediaId: null }, label: "", labelColor: CT.char, labelBackground: CT.amber, separator: "/", direction: "left", motion: "pages", pageSeconds: 7 }) },
  { kind: "scene", id: "look-contemporary-scene-bible", family: "contemporary", name: "Contemporary · Camera and scripture", purpose: "The camera with the verse as words alone over it.", layout: "scene", content: "bible", background: "dark", aspect: "16:9",
    scene: { background: "#000000", layers: cameraWith("bible", "look-contemporary-bible-l3") } },
  { kind: "scene", id: "look-contemporary-scene-lyrics", family: "contemporary", name: "Contemporary · Camera and lyrics", purpose: "The worship camera with the lyrics as words alone.", layout: "scene", content: "lyrics", background: "dark", aspect: "16:9",
    scene: { background: "#000000", layers: cameraWith("lyrics", "look-contemporary-lyrics-l3") } },
]

// ── Warm Editorial ───────────────────────────────────────────────────────
const WE = { paper: "#f4efe6", ink: "#2b2620", brass: "#8a6a3a", rule: "#b38c58", night: "#2a2420", cream: "#efe6d6" }
const editorial: LibraryLook[] = [
  { kind: "theme", id: "look-editorial-bible-full", family: "warm-editorial", name: "Editorial · Scripture page", purpose: "Scripture set like a book page on warm paper.", layout: "fullscreen", content: "bible", background: "light", aspect: "16:9",
    theme: theme("look-editorial-bible-full", "Editorial · Scripture page", {
      background: solid(WE.paper),
      verseText: words(SERIF, 64, 400, WE.ink, { horizontalAlign: "left", lineHeight: 1.55 }),
      secondaryVerseText: words(SERIF, 54, 400, WE.brass, { horizontalAlign: "left", lineHeight: 1.5 }),
      verseNumbers: { visible: true, fontSize: 22, color: WE.rule, superscript: true },
      reference: reference(PLEX, 28, 600, WE.brass, { horizontalAlign: "left", uppercase: true, letterSpacing: 3 }),
      layout: fullFrame("left", 160, 100),
    }) },
  { kind: "theme", id: "look-editorial-lyrics-full", family: "warm-editorial", name: "Editorial · Hymn page", purpose: "Hymns and songs on paper, the second language in brass.", layout: "fullscreen", content: "lyrics", background: "light", aspect: "16:9",
    theme: theme("look-editorial-lyrics-full", "Editorial · Hymn page", {
      background: solid(WE.paper),
      verseText: words(SERIF, 66, 500, WE.ink, { lineHeight: 1.4 }),
      secondaryVerseText: words(SERIF, 54, 400, "#7a5b33", { lineHeight: 1.35 }),
      verseNumbers: { visible: true, fontSize: 24, color: WE.rule, superscript: false },
      reference: reference(PLEX, 26, 600, WE.brass, { uppercase: true, letterSpacing: 3 }),
      layout: fullFrame("center"),
    }) },
  { kind: "theme", id: "look-editorial-quiet", family: "warm-editorial", name: "Editorial · Quiet moment", purpose: "Prayer, communion or a memorial: soft cream words on a deep warm ground.", layout: "fullscreen", content: "bible", background: "dark", aspect: "16:9",
    theme: theme("look-editorial-quiet", "Editorial · Quiet moment", {
      background: solid(WE.night),
      verseText: words(SERIF, 62, 400, WE.cream, { lineHeight: 1.6 }),
      secondaryVerseText: words(SERIF, 52, 400, "#cdb08a", { lineHeight: 1.5 }),
      verseNumbers: { visible: false, fontSize: 22, color: "#cdb08a", superscript: true },
      reference: reference(SERIF, 30, 500, "#cdb08a", { letterSpacing: 2, position: "below" }),
      layout: fullFrame("center", 200, 120),
      transition: { type: "fade", duration: 800, easing: "ease-in-out", direction: "up" },
    }) },
  { kind: "theme", id: "look-editorial-bible-l3", family: "warm-editorial", name: "Editorial · Scripture card", purpose: "A light paper card over the camera; reads well on dark video.", layout: "lower-third", content: "bible", background: "transparent", aspect: "16:9",
    theme: theme("look-editorial-bible-l3", "Editorial · Scripture card", {
      background: TRANSPARENT,
      textBox: box(WE.paper, 0.95, 4, 22),
      verseText: words(SERIF, 46, 400, WE.ink, { horizontalAlign: "left", lineHeight: 1.4 }),
      secondaryVerseText: words(SERIF, 40, 400, "#7a5b33", { horizontalAlign: "left", lineHeight: 1.35 }),
      verseNumbers: { visible: true, fontSize: 20, color: WE.rule, superscript: true },
      reference: reference(PLEX, 24, 600, WE.brass, { horizontalAlign: "left", uppercase: true, letterSpacing: 2 }),
      layout: band("left", 30, 90, 40),
    }) },
  { kind: "theme", id: "look-editorial-lyrics-l3", family: "warm-editorial", name: "Editorial · Hymn card", purpose: "Hymn lines on a paper card over the camera.", layout: "lower-third", content: "lyrics", background: "transparent", aspect: "16:9",
    theme: theme("look-editorial-lyrics-l3", "Editorial · Hymn card", {
      background: TRANSPARENT,
      textBox: box(WE.paper, 0.95, 4, 20),
      verseText: words(SERIF, 46, 500, WE.ink, { lineHeight: 1.3 }),
      secondaryVerseText: words(SERIF, 38, 400, "#7a5b33", { lineHeight: 1.3 }),
      verseNumbers: { visible: false, fontSize: 20, color: WE.rule, superscript: true },
      reference: reference(PLEX, 22, 600, WE.brass, { uppercase: true, letterSpacing: 2, position: "below" }),
      layout: band("center", 28, 90, 40),
    }) },
  { kind: "theme", id: "look-editorial-announcement", family: "warm-editorial", name: "Editorial · Notice page", purpose: "Notices set like a printed bulletin on warm paper.", layout: "fullscreen", content: "announcements", background: "light", aspect: "16:9",
    theme: theme("look-editorial-announcement", "Editorial · Notice page", {
      background: solid(WE.paper),
      verseText: words(SERIF, 54, 400, WE.ink, { horizontalAlign: "left", lineHeight: 1.5 }),
      secondaryVerseText: words(SERIF, 46, 400, "#7a5b33", { horizontalAlign: "left", lineHeight: 1.45 }),
      verseNumbers: NO_NUMBERS(WE.rule),
      reference: reference(SERIF, 64, 600, WE.ink, { horizontalAlign: "left" }),
      layout: fullFrame("left", 160, 100),
    }) },
  { kind: "lower-third", id: "look-editorial-speaker", family: "warm-editorial", name: "Editorial · Name card", purpose: "A paper name card with a brass rule.", layout: "lower-third", content: "speaker", background: "transparent", aspect: "16:9",
    style: speaker("look-editorial-speaker", "Editorial · Name card", {
      align: "left", margin: 6, bottom: 9, width: 0, height: 13, fontFamily: SERIF,
      line1: { size: 38, color: WE.ink, weight: 600, uppercase: false }, line2: { size: 22, color: WE.brass, weight: 500 },
      background: { kind: "color", color: WE.paper, opacity: 0.96, mediaId: null }, radius: 2, accent: { enabled: true, color: WE.rule, width: 6 }, animation: "fade",
    }) },
  { kind: "ticker", id: "look-editorial-ticker", family: "warm-editorial", name: "Editorial · This week", purpose: "A slow, paper-toned crawl for the week's notices.", layout: "ticker", content: "announcements", background: "transparent", aspect: "16:9", languages: ["en"],
    style: ticker({ position: "bottom", height: 7, speed: 100, fontFamily: SERIF, size: 50, color: WE.ink, weight: 500, background: { kind: "color", color: WE.paper, opacity: 0.96, mediaId: null }, label: "THIS WEEK", labelColor: "#ffffff", labelBackground: WE.brass, separator: "·", direction: "left", motion: "crawl", pageSeconds: 6 }) },
  { kind: "scene", id: "look-editorial-scene-bible", family: "warm-editorial", name: "Editorial · Camera and scripture", purpose: "The camera with a paper scripture card over it.", layout: "scene", content: "bible", background: "dark", aspect: "16:9",
    scene: { background: "#000000", layers: cameraWith("bible", "look-editorial-bible-l3") } },
  { kind: "scene", id: "look-editorial-scene-lyrics", family: "warm-editorial", name: "Editorial · Camera and hymn", purpose: "The camera with a paper hymn card over it.", layout: "scene", content: "lyrics", background: "dark", aspect: "16:9",
    scene: { background: "#000000", layers: cameraWith("lyrics", "look-editorial-lyrics-l3") } },
]

// ── High Contrast ────────────────────────────────────────────────────────
const HC = { black: "#000000", white: "#ffffff", yellow: "#ffd84d" }
const contrast: LibraryLook[] = [
  { kind: "theme", id: "look-contrast-bible-full", family: "high-contrast", name: "High Contrast · Scripture", purpose: "Large white words on black with a yellow reference; wide safe margins.", layout: "fullscreen", content: "bible", background: "dark", aspect: "16:9",
    theme: theme("look-contrast-bible-full", "High Contrast · Scripture", {
      background: solid(HC.black),
      verseText: words(INTER, 82, 700, HC.white, { horizontalAlign: "left", lineHeight: 1.35 }),
      secondaryVerseText: words(INTER, 70, 600, HC.yellow, { horizontalAlign: "left", lineHeight: 1.3 }),
      verseNumbers: { visible: true, fontSize: 30, color: HC.yellow, superscript: true },
      reference: reference(INTER, 46, 700, HC.yellow, { horizontalAlign: "left" }),
      layout: fullFrame("left", 120, 96),
      transition: { type: "none", duration: 0, easing: "linear", direction: "up" },
    }) },
  { kind: "theme", id: "look-contrast-lyrics-full", family: "high-contrast", name: "High Contrast · Lyrics", purpose: "Large lyrics for the back row and for people with low vision.", layout: "fullscreen", content: "lyrics", background: "dark", aspect: "16:9",
    theme: theme("look-contrast-lyrics-full", "High Contrast · Lyrics", {
      background: solid(HC.black),
      verseText: words(INTER, 86, 700, HC.white, { lineHeight: 1.3 }),
      secondaryVerseText: words(INTER, 72, 600, HC.yellow, { lineHeight: 1.25 }),
      verseNumbers: { visible: true, fontSize: 30, color: HC.yellow, superscript: false },
      reference: reference(INTER, 36, 700, HC.yellow, { position: "below" }),
      layout: fullFrame("center", 110, 90),
      transition: { type: "none", duration: 0, easing: "linear", direction: "up" },
    }) },
  { kind: "theme", id: "look-contrast-lyrics-light", family: "high-contrast", name: "High Contrast · Lyrics on white", purpose: "Black on white for rooms where the projector washes out dark looks.", layout: "fullscreen", content: "lyrics", background: "light", aspect: "16:9",
    theme: theme("look-contrast-lyrics-light", "High Contrast · Lyrics on white", {
      background: solid(HC.white),
      verseText: words(INTER, 86, 700, "#000000", { lineHeight: 1.3 }),
      secondaryVerseText: words(INTER, 72, 600, "#1d3f8f", { lineHeight: 1.25 }),
      verseNumbers: { visible: true, fontSize: 30, color: "#1d3f8f", superscript: false },
      reference: reference(INTER, 36, 700, "#1d3f8f", { position: "below" }),
      layout: fullFrame("center", 110, 90),
      transition: { type: "none", duration: 0, easing: "linear", direction: "up" },
    }) },
  { kind: "theme", id: "look-contrast-bible-l3", family: "high-contrast", name: "High Contrast · Scripture band", purpose: "A solid black band with large words, kept clear of the frame edges.", layout: "lower-third", content: "bible", background: "transparent", aspect: "16:9",
    theme: theme("look-contrast-bible-l3", "High Contrast · Scripture band", {
      background: TRANSPARENT,
      textBox: box(HC.black, 0.94, 0, 26),
      verseText: words(INTER, 54, 700, HC.white, { horizontalAlign: "left", lineHeight: 1.3 }),
      secondaryVerseText: words(INTER, 46, 600, HC.yellow, { horizontalAlign: "left", lineHeight: 1.25 }),
      verseNumbers: { visible: true, fontSize: 26, color: HC.yellow, superscript: true },
      reference: reference(INTER, 32, 700, HC.yellow, { horizontalAlign: "left" }),
      layout: band("left", 36, 90, 54),
      transition: { type: "none", duration: 0, easing: "linear", direction: "up" },
    }) },
  { kind: "theme", id: "look-contrast-lyrics-l3", family: "high-contrast", name: "High Contrast · Lyrics band", purpose: "Lyrics in a solid black band, large and steady.", layout: "lower-third", content: "lyrics", background: "transparent", aspect: "16:9",
    theme: theme("look-contrast-lyrics-l3", "High Contrast · Lyrics band", {
      background: TRANSPARENT,
      textBox: box(HC.black, 0.94, 0, 24),
      verseText: words(INTER, 54, 700, HC.white, { lineHeight: 1.25 }),
      secondaryVerseText: words(INTER, 46, 600, HC.yellow, { lineHeight: 1.2 }),
      verseNumbers: { visible: false, fontSize: 26, color: HC.yellow, superscript: true },
      reference: reference(INTER, 28, 700, HC.yellow, { position: "below" }),
      layout: band("center", 34, 90, 54),
      transition: { type: "none", duration: 0, easing: "linear", direction: "up" },
    }) },
  { kind: "theme", id: "look-contrast-announcement", family: "high-contrast", name: "High Contrast · Announcement", purpose: "Large notices: a yellow title and white details on black, without motion.", layout: "fullscreen", content: "announcements", background: "dark", aspect: "16:9",
    theme: theme("look-contrast-announcement", "High Contrast · Announcement", {
      background: solid(HC.black),
      verseText: words(INTER, 66, 700, HC.white, { horizontalAlign: "left", lineHeight: 1.35 }),
      secondaryVerseText: words(INTER, 58, 600, HC.yellow, { horizontalAlign: "left", lineHeight: 1.3 }),
      verseNumbers: NO_NUMBERS(HC.yellow),
      reference: reference(INTER, 80, 800, HC.yellow, { horizontalAlign: "left" }),
      layout: fullFrame("left", 120, 96),
      transition: { type: "none", duration: 0, easing: "linear", direction: "up" },
    }) },
  { kind: "lower-third", id: "look-contrast-speaker", family: "high-contrast", name: "High Contrast · Name band", purpose: "A large name in white over black with a yellow bar; comes on without animation.", layout: "lower-third", content: "speaker", background: "transparent", aspect: "16:9",
    style: speaker("look-contrast-speaker", "High Contrast · Name band", {
      align: "left", margin: 6, bottom: 10, width: 0, height: 15, fontFamily: INTER,
      line1: { size: 40, color: HC.white, weight: 800, uppercase: false }, line2: { size: 28, color: HC.yellow, weight: 600 },
      background: { kind: "color", color: HC.black, opacity: 0.95, mediaId: null }, radius: 0, accent: { enabled: true, color: HC.yellow, width: 10 }, animation: "none",
    }) },
  { kind: "ticker", id: "look-contrast-ticker", family: "high-contrast", name: "High Contrast · Still notices", purpose: "Large notices one at a time, without motion.", layout: "ticker", content: "announcements", background: "transparent", aspect: "16:9", languages: ["en"],
    style: ticker({ position: "bottom", height: 9, speed: 100, fontFamily: INTER, size: 56, color: HC.white, weight: 700, background: { kind: "color", color: HC.black, opacity: 1, mediaId: null }, label: "NOTICE", labelColor: HC.black, labelBackground: HC.yellow, separator: "•", direction: "left", motion: "pages", pageSeconds: 8 }) },
  { kind: "scene", id: "look-contrast-scene-bible", family: "high-contrast", name: "High Contrast · Camera and scripture", purpose: "The camera with the large scripture band over it.", layout: "scene", content: "bible", background: "dark", aspect: "16:9",
    scene: { background: "#000000", layers: cameraWith("bible", "look-contrast-bible-l3") } },
  { kind: "scene", id: "look-contrast-scene-lyrics", family: "high-contrast", name: "High Contrast · Camera and lyrics", purpose: "The camera with the large lyrics band over it.", layout: "scene", content: "lyrics", background: "dark", aspect: "16:9",
    scene: { background: "#000000", layers: cameraWith("lyrics", "look-contrast-lyrics-l3") } },
  { kind: "stage", id: "look-contrast-stage", family: "high-contrast", name: "High Contrast · Large confidence", purpose: "Bigger live words on the stage display, with a warning five minutes before time.", layout: "stage", content: "stage", background: "dark", aspect: "16:9",
    style: stage({ background: "#000000", words: "#ffffff", wordsScale: 1.4, showTimer: true, showNext: true, showNote: true, showBand: false, showFinish: true, warnAtMinutes: 5, warnWhenOver: true }) },
]

// ── Seasonal ─────────────────────────────────────────────────────────────
const seasonal: LibraryLook[] = [
  { kind: "theme", id: "look-seasonal-easter", family: "seasonal", name: "Easter morning", purpose: "Scripture on a pale spring ground with olive accents.", layout: "fullscreen", content: "bible", background: "light", aspect: "16:9",
    theme: theme("look-seasonal-easter", "Easter morning", {
      background: solid("#f6f3ea"),
      verseText: words(SERIF, 66, 400, "#2f3a2c", { lineHeight: 1.5 }),
      secondaryVerseText: words(SERIF, 56, 400, "#5f7244", { lineHeight: 1.45 }),
      verseNumbers: { visible: true, fontSize: 22, color: "#7b8f5a", superscript: true },
      reference: reference(PLEX, 30, 600, "#5f7244", { uppercase: true, letterSpacing: 3 }),
      layout: fullFrame("center"),
    }) },
  { kind: "theme", id: "look-seasonal-christmas", family: "seasonal", name: "Christmas evening", purpose: "Carols and readings in cream on deep pine, with gold.", layout: "fullscreen", content: "lyrics", background: "dark", aspect: "16:9",
    theme: theme("look-seasonal-christmas", "Christmas evening", {
      background: solid("#142019"),
      verseText: words(SERIF, 66, 500, "#f3efe4", { lineHeight: 1.4 }),
      secondaryVerseText: words(SERIF, 56, 400, "#c9a86a", { lineHeight: 1.35 }),
      verseNumbers: { visible: true, fontSize: 24, color: "#c9a86a", superscript: false },
      reference: reference(SERIF, 32, 600, "#c9a86a", { letterSpacing: 2 }),
      layout: fullFrame("center"),
      transition: { type: "fade", duration: 600, easing: "ease-in-out", direction: "up" },
    }) },
  { kind: "theme", id: "look-seasonal-celebration", family: "seasonal", name: "Celebration", purpose: "Thanksgiving, harvest or anniversary songs on a warm wine ground.", layout: "fullscreen", content: "lyrics", background: "dark", aspect: "16:9",
    theme: theme("look-seasonal-celebration", "Celebration", {
      background: solid("#3a1f24"),
      verseText: words(GEIST, 72, 700, "#f5e9d8", { lineHeight: 1.25 }),
      secondaryVerseText: words(GEIST, 58, 500, "#e7b96a", { lineHeight: 1.25 }),
      verseNumbers: { visible: false, fontSize: 22, color: "#e7b96a", superscript: true },
      reference: reference(MONO, 24, 500, "#e7b96a", { uppercase: true, letterSpacing: 3, position: "below" }),
      layout: fullFrame("center"),
    }) },
  { kind: "lower-third", id: "look-seasonal-conference", family: "seasonal", name: "Conference · Speaker", purpose: "Speaker names for a conference or convention, navy with a gold bar.", layout: "lower-third", content: "speaker", background: "transparent", aspect: "16:9",
    style: speaker("look-seasonal-conference", "Conference · Speaker", {
      align: "left", margin: 5, bottom: 9, width: 0, height: 13, fontFamily: GEIST,
      line1: { size: 38, color: "#ffffff", weight: 700, uppercase: false }, line2: { size: 24, color: "#e0b04a", weight: 500 },
      background: { kind: "color", color: "#0f1d2b", opacity: 0.92, mediaId: null }, radius: 6, accent: { enabled: true, color: "#e0b04a", width: 8 }, animation: "slide",
    }) },
]

/** Every look in the library, family by family. */
export const LIBRARY_LOOKS: readonly LibraryLook[] = [...classic, ...clean, ...contemporary, ...editorial, ...contrast, ...seasonal]
