import type { SongQueueItem } from "@/types"

/** A choir ministration is a song the choir sings to the church, kept in the same library, marked by this tag. */
export const CHOIR_TAG = "choir"
const CAC_HYMN_TAG = "cacghb"

const parts = (tags: string | undefined) => (tags ?? "").split(",").map((t) => t.trim()).filter(Boolean)

export const isChoir = (tags: string | undefined) => parts(tags).some((t) => t.toLowerCase() === CHOIR_TAG)

/** The tags with the choir mark added or removed; the others kept as they are. */
export function withChoir(tags: string | undefined, on: boolean): string {
  const rest = parts(tags).filter((t) => t.toLowerCase() !== CHOIR_TAG)
  return (on ? [CHOIR_TAG, ...rest] : rest).join(", ")
}

/** Whether a queued song is a hymn, using its saved identity before library fallbacks. */
export function isHymnSong(
  song: Pick<SongQueueItem["song"], "hymn" | "hymn_numbers">,
  libraryTags?: string,
  libraryNumbers: readonly string[] = [],
): boolean {
  if (typeof song.hymn === "boolean") return song.hymn
  return !!song.hymn_numbers?.length || libraryNumbers.length > 0 || parts(libraryTags).some((tag) => tag.toLowerCase() === CAC_HYMN_TAG)
}

/** Friendly hymnbook numbers from a loaded song; matches the library's displayed number. */
export function hymnNumbersFromLibrary(numbers: readonly { hymnbook_code: string; number: string }[]): string[] {
  return numbers.map(({ hymnbook_code, number }) => `${hymnbook_code} ${number}`)
}

/** Label used throughout Prepare, Present and Home for a song or numbered hymn. */
export function songKindLabel(item: SongQueueItem, libraryNumbers: readonly string[] = [], libraryTags?: string): string {
  const numbers = item.song.hymn_numbers !== undefined ? item.song.hymn_numbers : libraryNumbers
  if (!isHymnSong(item.song, libraryTags, numbers)) return "Song"
  return numbers.length ? `Hymn · ${numbers.join(", ")}` : "Hymn"
}
