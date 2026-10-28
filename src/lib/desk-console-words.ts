/** The desk consoles' small shared words and shapes (#197), apart from their views. */

/** A verse as the host's library answers a lookup. */
export interface HostVerse { book: number; bookName: string; chapter: number; verse: number; text: string }

/** The verse asked for and the two after it, from a chapter (empty when that verse is not there). */
export function passageFrom(chapter: readonly HostVerse[], verse: number): HostVerse[] {
  const at = chapter.findIndex((v) => v.verse === verse)
  return at === -1 ? [] : chapter.slice(at, at + 3)
}

/** One paired desk on the director's board. */
export interface CrewRow { name: string; role: string; connected: boolean; lastSeenMs: number | null; paused?: boolean }

/** "Connected", "Seen just now", "Seen 4 min ago", "Not connected" for one desk on the director's board. */
export function crewWords(c: CrewRow, now: number): string {
  if (c.connected) return "Connected"
  if (c.lastSeenMs === null) return "Not connected"
  const min = Math.floor(Math.max(0, now - c.lastSeenMs) / 60_000)
  return min < 1 ? "Seen just now" : `Seen ${min} min ago`
}
