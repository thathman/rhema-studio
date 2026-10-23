/** The kinds of content an output can give its own look (theme). */
export const CONTENT_TYPES = ["bible", "song", "hymn", "slide", "picture"] as const
export type ContentType = (typeof CONTENT_TYPES)[number]

export interface VerseSegment {
  verseNumber?: number
  text: string
}

export interface VerseRenderData {
  /** Absent means a Bible verse. `lyric` is a song slide, `slide` a custom slide (both use `lines`), `image` a picture. */
  kind?: "verse" | "lyric" | "slide" | "image"
  /** What this is, for an output that has its own look per kind of content (themeFor). Quick screens have none. */
  content?: ContentType
  reference: string
  segments: VerseSegment[]
  /** Separate unlabeled translation lines rendered with a blank line between them. */
  translationLines?: string[]
  /**
   * Lyric slides: each entry is one line of the song, drawn on its own line
   * in the verse style (no wrapping across entries). `segments` is ignored
   * when set.
   */
  lines?: string[]
  /** Same section in the second language, after a gap, in the secondary style. */
  secondaryLines?: string[]
  /** Small copyright line at the bottom of the text area. */
  footer?: string
  /** A picture over the whole frame (above the theme background). */
  image?: ThemeImageFill
  /**
   * A whole-frame quick screen with no text: "black" (fully transparent on a
   * keyed theme, so the stream shows nothing) or "logo" (the output's own
   * theme logo, large and centred).
   */
  screen?: "black" | "logo"
  /** A quick screen (Welcome, Offering…, Black, Logo): for the service log only; outputs ignore it. */
  quick?: boolean
  /** Which quick screen this is ("welcome", "black"…), so Present can mark the one on air. */
  quickScreen?: string
  /**
   * A video over the whole frame. Output windows play it in a <video> element
   * and draw its frames; anywhere without that element (the main window's
   * monitors) the renderer shows "▶ name" instead.
   */
  video?: { url: string; fit: "cover" | "contain" | "stretch"; loop: boolean; sound: boolean; name: string; token: number }
}

export interface RenderOptions {
  opacity?: number
  offsetX?: number
  offsetY?: number
  scale?: number // Scale factor for rendering at display size (e.g., 0.42 for 400px panel)
  imageCache?: Map<string, HTMLImageElement>
  /** The playing element for `verse.video`, when this canvas has one (output windows). */
  video?: HTMLVideoElement | null
  /** Its state: "loading" draws only the background (no label on the live screen), "failed" draws the label. */
  videoState?: "loading" | "ready" | "failed"
}

/** A freely positioned element region, all values in % of canvas size (0-100), x/y = top-left. */
export interface ElementBox {
  x: number
  y: number
  width: number
  height: number
}

/** An image fill: how a picture is fitted into whatever rect it is drawn in. */
export interface ThemeImageFill {
  url: string
  fit: "cover" | "contain" | "stretch"
  blur: number
  brightness: number
  tint: string | null
}

export interface ThemeLogo {
  /** Data URL, like every other theme image, so outputs need nothing else. */
  url: string
  corner: "top-left" | "top-right" | "bottom-left" | "bottom-right"
  /** Height as a percentage of the frame height (4–25). */
  size: number
  /** 0–1 */
  opacity: number
  /** Draw it on transparent (OBS) themes too; off by default so the key stays clean. */
  showOnTransparent: boolean
}

/**
 * A filled surface drawn behind content — the container the text lives in.
 * Content wraps inside it, inset by `padding`.
 */
export interface SurfaceFill {
  enabled: boolean
  color: string
  opacity: number
  borderRadius: number
  /** Inset for the content on this surface, in theme px. */
  padding: number
  /** When set, fills the surface, clipped to `borderRadius`. */
  image: ThemeImageFill | null
}

export type TextHorizontalAlign = "left" | "center" | "right" | "justify"
export type TextVerticalAlign = "top" | "middle" | "bottom"
export type TextTransform = "none" | "uppercase" | "lowercase" | "capitalize"
export type TextDecoration = "none" | "underline" | "line-through"

export interface VerseTextStyle {
  fontFamily: string
  fontSize: number
  fontWeight: number
  color: string
  horizontalAlign?: TextHorizontalAlign
  verticalAlign?: TextVerticalAlign
  textTransform?: TextTransform
  textDecoration?: TextDecoration
  lineHeight: number
  letterSpacing: number
  shadow: { color: string; blur: number; x: number; y: number } | null
  outline: { color: string; width: number } | null
  /** Optional plate behind this translation's text alone. */
  surface?: SurfaceFill
}

export interface BroadcastTheme {
  id: string
  name: string
  builtin: boolean
  pinned: boolean
  createdAt: number
  updatedAt: number
  resolution: { width: number; height: number }
  background: {
    type: "solid" | "gradient" | "image" | "transparent"
    color: string
    gradient: {
      type: "linear" | "radial"
      angle: number
      stops: { color: string; position: number }[]
    } | null
    image: ThemeImageFill | null
  }
  /**
   * The container holding the reference + verse block. Its fill can be a
   * colour or an image, and the text wraps inside it.
   */
  textBox: SurfaceFill
  verseText: VerseTextStyle
  /** Optional independent styling for the second translation line. */
  secondaryVerseText?: VerseTextStyle
  verseNumbers: {
    visible: boolean
    fontSize: number
    color: string
    superscript: boolean
  }
  reference: {
    fontFamily: string
    fontSize: number
    fontWeight: number
    color: string
    horizontalAlign?: TextHorizontalAlign
    verticalAlign?: TextVerticalAlign
    textTransform?: TextTransform
    textDecoration?: TextDecoration
    uppercase: boolean
    letterSpacing: number
    position: "above" | "below" | "inline"
    /** Optional chip behind the reference alone. Absent means none. */
    surface?: SurfaceFill
  }
  layout: {
    anchor:
      | "center"
      | "top-left"
      | "top-center"
      | "top-right"
      | "bottom-left"
      | "bottom-center"
      | "bottom-right"
    offsetX: number
    offsetY: number
    padding: { top: number; right: number; bottom: number; left: number }
    textAlign: "left" | "center" | "right"
    backgroundWidth: number
    backgroundHeight: number
    textAreaWidth: number
    textAreaHeight: number
    referenceGap?: number
    /**
     * Space between the first and second language of a bilingual verse or song
     * slide, in theme px. Absent: one line of the first language (as before).
     */
    languageGap?: number
    /** "stacked" (default): reference + verse flow as one block. "free": each is positioned by its box. */
    mode?: "stacked" | "free"
    referenceBox?: ElementBox
    verseBox?: ElementBox
  }
  /** A church logo in one corner (Brand Kit step 1). Absent = none. */
  logo?: ThemeLogo | null
  /** Generated and kept in step by the Church Brand Kit; set false after a hand edit to detach. */
  brandManaged?: boolean
  /** The Design → Library look this theme was copied from (Reset puts it back as that look has it). */
  libraryLookId?: string
  transition: {
    type: "fade" | "slide" | "scale" | "none"
    duration: number
    easing: "linear" | "ease-in" | "ease-out" | "ease-in-out"
    direction: "up" | "down" | "left" | "right"
  }
}
