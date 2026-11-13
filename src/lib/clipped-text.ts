import { forOutputLanguage } from "@/lib/output-language"
import { themeIdFor } from "@/lib/output-themes"
import { songSlides, toLyricRenderData } from "@/lib/lyrics"
import { hymnNumbersFromLibrary, isHymnSong } from "@/lib/song-kind"
import { onThemeFontsLoaded, textClipped } from "@/lib/verse-renderer"
import { isSongItem, type QueueItem, type SongWithSections, type VerseRenderData } from "@/types"
import type { BroadcastTheme } from "@/types/broadcast"
import type { BroadcastOutput } from "@/types/broadcast-output"

export interface ClippedText {
  /** "Romans 8:28", "Abide with me · Verse 2". */
  what: string
  output: string
}

// Each look's answers by the words shown: a service edit re-measures only what changed. A look
// edited in Design is a new object, so its answers start afresh; a font arriving starts all afresh
// (measured before it loaded, the fallback font's answers would be wrong).
let measured = new WeakMap<BroadcastTheme, Map<string, boolean>>()
onThemeFontsLoaded(() => { measured = new WeakMap() })
function clippedOn(theme: BroadcastTheme, data: VerseRenderData): boolean {
  let byText = measured.get(theme)
  if (!byText) measured.set(theme, (byText = new Map()))
  const key = JSON.stringify([data.lines, data.secondaryLines, data.translationLines, data.segments, data.footer, data.reference])
  let hit = byText.get(key)
  if (hit === undefined) byText.set(key, (hit = textClipped(theme, data)))
  return hit
}

/**
 * Planned words a congregation screen would cut off (#217, #213): each song slide and verse in the
 * service, drawn with the look and language of each congregation screen that shows that kind of
 * content, that does not fit even at the look's smallest size. Each slide and screen once.
 *
 * ponytail: not checked yet: screens showing a scene (each layer has its own look and language),
 * custom slides, a verse's second translation (fetched only when it goes up), songs not loaded.
 */
export function clippedText(items: QueueItem[], songs: Record<string, SongWithSections | undefined>, outputs: BroadcastOutput[], themes: BroadcastTheme[]): ClippedText[] {
  const screens = outputs.filter((o) => (o.role ?? "congregation") === "congregation" && !o.sceneId)
  const out = new Map<string, ClippedText>()
  const check = (what: string, data: VerseRenderData, content: "bible" | "song" | "hymn") => {
    for (const o of screens) {
      if (o.shows?.length && !o.shows.includes(content)) continue
      // As Live picks it: the look for this kind, else the output's own, else the first.
      const theme = themes.find((t) => t.id === themeIdFor(o, content)) ?? themes.find((t) => t.id === o.themeId) ?? themes[0]
      const shown = forOutputLanguage(data, o.language)
      if (theme && shown && clippedOn(theme, shown)) out.set(`${what}\u0000${o.name}`, { what, output: o.name })
    }
  }
  for (const item of items) {
    if (item.hidden) continue
    if (isSongItem(item)) {
      const song = songs[item.song.song_id]
      if (!song) continue
      // As Live decides it (use-broadcast), so a hymn is checked with the hymn look.
      const content = isHymnSong(item.song, song.song.tags, hymnNumbersFromLibrary(song.numbers)) ? "hymn" : "song"
      for (const slide of songSlides(song, item.song)) {
        const data = toLyricRenderData(song, slide)
        check(data.reference, data, content)
      }
    } else if (!item.kind || item.kind === "verse") {
      const v = item.verse
      check(item.reference, { reference: item.reference, segments: [{ verseNumber: v.verse, text: v.text }] }, "bible")
    }
  }
  return [...out.values()]
}
