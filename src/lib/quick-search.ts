/**
 * Quick Search Utility Functions
 * Pure functions for Bible reference autocomplete logic
 */

export interface Book {
  id: number
  translation_id: number
  book_number: number
  name: string
  abbreviation: string
  testament: string
}

export interface AutocompleteResult {
  suggestion: string
  matchedBook?: Book
  chapter?: number
  verse?: number
  stage: "book" | "chapter" | "verse" | "complete" | "none"
}

/**
 * Convert number to Roman numeral for numbered books
 */
export function numberToRoman(num: number): string {
  if (num === 1) return "I"
  if (num === 2) return "II"
  if (num === 3) return "III"
  return String(num)
}

/** Drop accents and tone marks ("Jòhánù" → "Johanu", "Ọba" → "Oba", "Ìṣe" → "Ise") so Yorùbá book names match however they are typed. */
export function foldMarks(input: string): string {
  return input.normalize("NFD").replace(/\p{M}/gu, "")
}

/**
 * Normalize numbered-book input to the Roman form used by some Bible data
 * sources. This keeps matching tolerant of Arabic, Roman, and ordinal
 * prefixes: "1 S", "I S", and "1st S" all become "I S".
 */
export function normalizeInput(input: string): string {
  const trimmed = foldMarks(input.trim())
  const leadingNumberMatch = trimmed.match(/^(\d+)(?:st|nd|rd|th)?\s*(.*)$/i)

  if (leadingNumberMatch) {
    const num = parseInt(leadingNumberMatch[1])
    const rest = leadingNumberMatch[2]
    return numberToRoman(num) + (rest ? " " + rest : "")
  }

  return trimmed
}

/**
 * Common short forms that are not a prefix of the book's name or the Bible
 * database's abbreviation ("Jn" for John, "Mt", "Php"), by canonical book
 * number so they work in every translation. Numbered books use the Roman
 * prefix normalizeInput produces ("1 Jn" → "i jn"). Only unambiguous forms.
 */
const BOOK_ALIASES: Record<string, number> = {
  gn: 1, dt: 5, jgs: 7, jdg: 7, "i sm": 9, "ii sm": 10, sos: 22, "song of songs": 22, sg: 22,
  jl: 29, ob: 31, hb: 35, hg: 37,
  mt: 40, mk: 41, mrk: 41, lk: 42, luk: 42, jn: 43, jhn: 43, rm: 45, php: 50, phm: 57, phlm: 57, jm: 59,
  "i pt": 60, "ii pt": 61, "i jn": 62, "i jhn": 62, "ii jn": 63, "ii jhn": 63, "iii jn": 64, "iii jhn": 64, jd: 65,
  rv: 66, revelations: 66,
}

/**
 * Yorùbá book names as the bundled Yorùbá Bible's own edition prints them
 * (eBible.org "yor", the OYCB source; checked 2026-10-21), accents folded,
 * by canonical book number. Numbered books carry the Roman prefix that
 * normalizeInput produces ("1 Ọba" → "i oba").
 */
const YORUBA_BOOKS: Array<[string, number]> = [
  ["genesisi", 1], ["eksodu", 2], ["lefitiku", 3], ["numeri", 4], ["deuteronomi", 5], ["josua", 6], ["onidajo", 7], ["rutu", 8],
  ["i samueli", 9], ["ii samueli", 10], ["i oba", 11], ["ii oba", 12], ["i kronika", 13], ["ii kronika", 14], ["esra", 15],
  ["nehemiah", 16], ["esteri", 17], ["jobu", 18], ["saamu", 19], ["owe", 20], ["oniwaasu", 21], ["orin solomoni", 22],
  ["isaiah", 23], ["jeremiah", 24], ["ekun jeremiah", 25], ["esekieli", 26], ["danieli", 27], ["hosea", 28], ["joeli", 29],
  ["amosi", 30], ["obadiah", 31], ["jona", 32], ["mika", 33], ["nahumu", 34], ["habakuku", 35], ["sefaniah", 36], ["hagai", 37],
  ["sekariah", 38], ["malaki", 39], ["matiu", 40], ["marku", 41], ["luku", 42], ["johanu", 43], ["ise awon aposteli", 44],
  ["romu", 45], ["i korinti", 46], ["ii korinti", 47], ["galatia", 48], ["efesu", 49], ["filipi", 50], ["kolose", 51],
  ["i tesalonika", 52], ["ii tesalonika", 53], ["i timotiu", 54], ["ii timotiu", 55], ["titu", 56], ["filemoni", 57],
  ["heberu", 58], ["jakobu", 59], ["i peteru", 60], ["ii peteru", 61], ["i johanu", 62], ["ii johanu", 63], ["iii johanu", 64],
  ["juda", 65], ["ifihan", 66],
]
const YORUBA_EXACT = new Map(YORUBA_BOOKS)

/**
 * Find matching book by name or abbreviation (case insensitive)
 */
export function findMatchingBook(bookInput: string, books: Book[]): Book | undefined {
  const normalized = normalizeInput(bookInput).toLowerCase()
  const key = normalized.replace(/\./g, "").replace(/\s+/g, " ").trim()
  const alias = BOOK_ALIASES[key] ?? YORUBA_EXACT.get(key)
  if (alias) {
    const book = books.find((b) => b.book_number === alias)
    if (book) return book
  }
  const english = books.find(
    b =>
      normalizeInput(b.name).toLowerCase().startsWith(normalized) ||
      normalizeInput(b.abbreviation).toLowerCase().startsWith(normalized)
  )
  if (english) return english
  // A Yorùbá name typed in part ("Joha", "Ise"); after the English names so their behaviour is unchanged.
  if (key.replace(/^[ivx]+ /, "").length < 3) return undefined
  const yo = YORUBA_BOOKS.find(([name]) => name.startsWith(key))
  return yo ? books.find((b) => b.book_number === yo[1]) : undefined
}

/** Books of one chapter: "Jude 5" is verse 5 (Obadiah, Philemon, 2 John, 3 John, Jude). */
const ONE_CHAPTER_BOOKS = new Set([31, 57, 63, 64, 65])

/** "Jn. 3:16" → "Jn 3:16"; a dot after a book abbreviation is not part of it. */
const dropAbbreviationDots = (s: string) => s.replace(/([a-zA-Z])\./g, "$1")

/** A verse range or list after the first verse ("3:16-18", "3:16, 18"): the first verse is the one shown. */
const RANGE_TAIL = String.raw`(?:\s*[-–—,]\s*\d+)*`

/**
 * Parse Bible reference input and return autocomplete suggestion
 */
export function getAutocompleteSuggestion(
  input: string,
  books: Book[]
): AutocompleteResult {
  const trimmed = input.trim()

  if (!trimmed) {
    return { suggestion: "", stage: "none" }
  }

  const normalizedInput = dropAbbreviationDots(normalizeInput(trimmed))

  // Check if it's just a number (for numbered books like "1", "2", "3")
  if (/^\d+(?:st|nd|rd|th)?$/i.test(trimmed)) {
    const matchingBook = findMatchingBook(trimmed, books)

    if (matchingBook) {
      return {
        suggestion: matchingBook.name + " 1:1",
        matchedBook: matchingBook,
        chapter: 1,
        verse: 1,
        stage: "book"
      }
    }
  }

  // Parse: "NumberedBook Chapter:Verse" or "BookName Chapter:Verse"
  // Match patterns like: "I J", "I John", "John", "John 3", "John 3:16"
  const match = normalizedInput.match(new RegExp(String.raw`^([IVX]+\s+[a-zA-Z]+|[IVX]+\s+[a-zA-Z\s]+|[a-zA-Z\s]+?)\s*(\d+)?:?(\d+)?` + RANGE_TAIL + "$"))

  if (!match) {
    return { suggestion: "", stage: "none" }
  }

  const bookInput = match[1].trim()
  const chapterNum = match[2]
  const verseNum = match[3]

  const matchingBook = findMatchingBook(bookInput, books)

  if (!matchingBook) {
    return { suggestion: "", stage: "none" }
  }

  // Stage 1: Autocomplete book name + suggest 1:1
  if (!chapterNum) {
    return {
      suggestion: matchingBook.name + " 1:1",
      matchedBook: matchingBook,
      chapter: 1,
      verse: 1,
      stage: "book"
    }
  }

  const chapter = parseInt(chapterNum)

  // "Jude 5": a one-chapter book's number is the verse.
  if (!verseNum && !trimmed.includes(":") && ONE_CHAPTER_BOOKS.has(matchingBook.book_number)) {
    return { suggestion: "", matchedBook: matchingBook, chapter: 1, verse: chapter, stage: "complete" }
  }

  // Stage 2: Suggest colon after chapter
  if (!verseNum && !trimmed.includes(':')) {
    return {
      suggestion: trimmed + ":1",
      matchedBook: matchingBook,
      chapter,
      verse: 1,
      stage: "chapter"
    }
  }

  // Stage 3: Has colon but no verse number yet
  if (!verseNum && trimmed.includes(':')) {
    return {
      suggestion: "",
      matchedBook: matchingBook,
      chapter,
      stage: "verse"
    }
  }

  // Stage 4: Complete reference
  if (verseNum) {
    const verse = parseInt(verseNum)
    return {
      suggestion: "",
      matchedBook: matchingBook,
      chapter,
      verse,
      stage: "complete"
    }
  }

  return { suggestion: "", stage: "none" }
}

export interface TypedReference {
  book: Book
  chapter: number
  verse: number
}

/**
 * Parse a fully-typed scripture reference like "John 3:16", "jn 3 16",
 * "1 cor 13:4", or "psalm 23.1".
 *
 * Only complete book+chapter+verse references parse — book-only or
 * book+chapter input returns null (too ambiguous to pin a search result).
 * Free text like "johnny walked" never parses: the trailing numbers are
 * required and the book part must prefix-match a real book.
 */
export function parseTypedReference(
  input: string,
  books: Book[]
): TypedReference | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const normalized = normalizeInput(trimmed)
  // Book words, then chapter and verse separated by ":", ".", or whitespace (a range or list after it: its first verse).
  const match = normalized.match(
    new RegExp(String.raw`^([IVX]+\s+[a-zA-Z.]+|[a-zA-Z][a-zA-Z.\s]*?)\s*(\d{1,3})\s*[:.\s]\s*(\d{1,3})` + RANGE_TAIL + "$")
  )
  if (!match) {
    // "Jude 5": a one-chapter book and one number.
    const one = normalized.match(/^([IVX]+\s+[a-zA-Z.]+|[a-zA-Z][a-zA-Z.\s]*?)\s*(\d{1,3})$/)
    const book = one ? findMatchingBook(one[1].trim().replace(/\.$/, ""), books) : undefined
    if (!one || !book || !ONE_CHAPTER_BOOKS.has(book.book_number) || parseInt(one[2]) < 1) return null
    return { book, chapter: 1, verse: parseInt(one[2]) }
  }

  const book = findMatchingBook(match[1].trim().replace(/\.$/, ""), books)
  if (!book) return null

  const chapter = parseInt(match[2])
  const verse = parseInt(match[3])
  if (chapter < 1 || verse < 1) return null

  return { book, chapter, verse }
}

/**
 * Determine what should happen when Tab/Arrow-Right is pressed
 */
export function getTabNavigationResult(
  currentInput: string,
  currentSuggestion: string
): string {
  if (!currentSuggestion || currentSuggestion === currentInput) {
    return currentInput
  }

  let trimmed = currentInput.trim()
  const suggestionTrimmed = currentSuggestion.trim()

  // Extract the full book name from the suggestion
  const bookNameMatch = suggestionTrimmed.match(/^(((?:\d+|[IVX]+)\s+)?[\p{L}\p{M}\s]+)\s+\d+:\d+$/iu)

  if (bookNameMatch) {
    const fullBookName = bookNameMatch[1]

    // A short form or Yorùbá name ("jn", "Jòhánù 3") is not a prefix of the
    // suggested name: carry on from that name, keeping the typed numbers.
    const typedBook = trimmed.replace(/\s*\d[\d:\s]*$/, "")
    const typedNumbers = trimmed.slice(typedBook.length).trim()
    if (typedBook && !foldMarks(fullBookName).toLowerCase().startsWith(foldMarks(typedBook).toLowerCase())) {
      if (!typedNumbers) return fullBookName + " "
      trimmed = `${fullBookName} ${typedNumbers}`
    }

    // Check if current input matches the COMPLETE book name
    const currentIsCompleteBookName =
      trimmed === fullBookName + " " || trimmed === fullBookName

    // Check if current input has a chapter number
    const hasChapter =
      new RegExp(`^${fullBookName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+\\d+`, 'i').test(trimmed) &&
      !trimmed.includes(':')

    // Stage 1: Still typing book name -> advance to complete book name
    if (!currentIsCompleteBookName && !hasChapter) {
      return fullBookName + " "
    }

    // Stage 2: Has chapter -> advance to chapter with colon
    if (hasChapter) {
      const chapterMatch = suggestionTrimmed.match(/^(((?:\d+|[IVX]+)\s+)?[\p{L}\p{M}\s]+\s+\d+):\d+$/iu)
      if (chapterMatch) {
        return chapterMatch[1] + ":"
      }
    }
  }

  // Default: accept full suggestion
  return currentSuggestion
}
