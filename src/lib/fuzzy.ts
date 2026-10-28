import type { SongSummary } from "@/types"

/** Yoruba dots and tone marks fold to the base letter so "olorun" matches "Ọlọ́run" (same rule as the crate's index). */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ẹ/g, "e").replace(/Ẹ/g, "E").replace(/ọ/g, "o").replace(/Ọ/g, "O").replace(/ṣ/g, "s").replace(/Ṣ/g, "S")
    .toLowerCase()
}

/** Damerau-free Levenshtein, capped: good enough for a mistyped hymn title. */
export function editDistance(a: string, b: string, max = 3): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      rowMin = Math.min(rowMin, cur[j])
    }
    if (rowMin > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

const words = (s: string) => fold(s).split(/[^a-z0-9]+/).filter((w) => w.length > 1)

/**
 * Does every word the volunteer typed fit a word of the song's title or first
 * line, allowing one typo per short word and two per long one, or a prefix?
 * Returns a score (lower is better) or null for no match.
 */
export function fuzzyScore(query: string, song: Pick<SongSummary, "title" | "first_line" | "authors">): number | null {
  const q = words(query)
  if (q.length === 0) return null
  const haystack = [...words(song.title), ...words(song.first_line), ...words(song.authors)]
  if (haystack.length === 0) return null
  let total = 0
  for (const w of q) {
    let best: number | null = null
    for (const h of haystack) {
      const allowed = w.length <= 4 ? 1 : 2
      const d = h.startsWith(w) ? 0 : editDistance(w, h, allowed)
      if (d <= allowed && (best === null || d < best)) best = d
    }
    if (best === null) return null
    total += best
  }
  return total
}

/** Songs that nearly match, best first. Used only when the exact search found nothing. */
export function fuzzySongs(query: string, songs: SongSummary[], limit = 6): SongSummary[] {
  return songs
    .map((s) => ({ s, score: fuzzyScore(query, s) }))
    .filter((x): x is { s: SongSummary; score: number } => x.score !== null)
    .sort((a, b) => a.score - b.score || a.s.title.localeCompare(b.s.title))
    .slice(0, limit)
    .map((x) => x.s)
}
