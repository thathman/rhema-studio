import type { LibrarySection } from "@/studio/shell-store"

/** Library sections that search by words handed from here (#407). */
const FIND_IN: ReadonlyArray<readonly [LibrarySection, string]> = [["hymns", "the Hymn book"], ["songs", "Songs"], ["bible", "the Bible"]]

/** Where Find anything offers to look: the Bible only for words with a number, and first when they read like a reference ("romans 8 28", "1 John 3:16"). */
export function findInOrder(query: string): ReadonlyArray<readonly [LibrarySection, string]> {
  const q = query.trim()
  if (!/\d/.test(q)) return FIND_IN.filter(([section]) => section !== "bible")
  const reference = /^[1-3]?\s*[A-Za-z]{2,}\.?\s+\d+(\s*[:.\s]\s*\d+)?/.test(q)
  return reference ? [...FIND_IN.filter(([section]) => section === "bible"), ...FIND_IN.filter(([section]) => section !== "bible")] : FIND_IN
}
