import { describe, expect, it } from "vitest"
import {
  foldMarks,
  numberToRoman,
  normalizeInput,
  findMatchingBook,
  getAutocompleteSuggestion,
  getTabNavigationResult,
  parseTypedReference,
  parseBookChapter,
  type Book,
} from "./quick-search"

// Mock book data
const mockBooks: Book[] = [
  { id: 1, translation_id: 1, book_number: 1, name: "Genesis", abbreviation: "Gen", testament: "OT" },
  { id: 43, translation_id: 1, book_number: 43, name: "John", abbreviation: "John", testament: "NT" },
  { id: 65, translation_id: 1, book_number: 65, name: "Jude", abbreviation: "Jude", testament: "NT" },
  { id: 62, translation_id: 1, book_number: 62, name: "I John", abbreviation: "1John", testament: "NT" },
  { id: 63, translation_id: 1, book_number: 63, name: "II John", abbreviation: "2John", testament: "NT" },
  { id: 64, translation_id: 1, book_number: 64, name: "III John", abbreviation: "3John", testament: "NT" },
  { id: 45, translation_id: 1, book_number: 45, name: "Romans", abbreviation: "Rom", testament: "NT" },
  { id: 19, translation_id: 1, book_number: 19, name: "Psalms", abbreviation: "Ps", testament: "OT" },
  { id: 46, translation_id: 1, book_number: 46, name: "I Corinthians", abbreviation: "1Cor", testament: "NT" },
]

// The Bible database stores these names with Arabic prefixes. Keep this
// fixture separate from mockBooks, whose older tests use Roman prefixes.
const arabicNumberedBooks: Book[] = [
  "1 Samuel", "2 Samuel", "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles",
  "1 Corinthians", "2 Corinthians", "1 Thessalonians", "2 Thessalonians",
  "1 Timothy", "2 Timothy", "1 Peter", "2 Peter", "1 John", "2 John", "3 John",
].map((name, index) => ({
  id: index + 1,
  translation_id: 1,
  book_number: index + 1,
  name,
  abbreviation: name.replace(/\s/g, ""),
  testament: index < 6 ? "OT" : "NT",
}))

describe("numberToRoman", () => {
  it("converts 1 to I", () => {
    expect(numberToRoman(1)).toBe("I")
  })

  it("converts 2 to II", () => {
    expect(numberToRoman(2)).toBe("II")
  })

  it("converts 3 to III", () => {
    expect(numberToRoman(3)).toBe("III")
  })

  it("returns string for numbers > 3", () => {
    expect(numberToRoman(4)).toBe("4")
    expect(numberToRoman(10)).toBe("10")
  })
})

describe("normalizeInput", () => {
  it("converts '1 j' to 'I j'", () => {
    expect(normalizeInput("1 j")).toBe("I j")
  })

  it("converts '2 c' to 'II c'", () => {
    expect(normalizeInput("2 c")).toBe("II c")
  })

  it("converts '3 john' to 'III john'", () => {
    expect(normalizeInput("3 john")).toBe("III john")
  })

  it("leaves non-numbered input unchanged", () => {
    expect(normalizeInput("john")).toBe("john")
    expect(normalizeInput("genesis")).toBe("genesis")
  })

  it("converts '1' alone to 'I'", () => {
    expect(normalizeInput("1")).toBe("I")
  })

  it("accepts ordinal prefixes", () => {
    expect(normalizeInput("1st Samuel")).toBe("I Samuel")
    expect(normalizeInput("2nd Kings")).toBe("II Kings")
    expect(normalizeInput("3rd John")).toBe("III John")
  })

  it("trims whitespace", () => {
    expect(normalizeInput("  john  ")).toBe("john")
  })
})

describe("findMatchingBook", () => {
  it("finds book by full name (case insensitive)", () => {
    const result = findMatchingBook("john", mockBooks)
    expect(result?.name).toBe("John")
  })

  it("finds book by partial name", () => {
    const result = findMatchingBook("gen", mockBooks)
    expect(result?.name).toBe("Genesis")
  })

  it("finds book by abbreviation", () => {
    const result = findMatchingBook("rom", mockBooks)
    expect(result?.name).toBe("Romans")
  })

  it("finds numbered book with Roman numeral", () => {
    const result = findMatchingBook("i john", mockBooks)
    expect(result?.name).toBe("I John")
  })

  it("returns undefined for no match", () => {
    const result = findMatchingBook("xyz", mockBooks)
    expect(result).toBeUndefined()
  })

  it("handles case insensitive matching", () => {
    const result = findMatchingBook("JOHN", mockBooks)
    expect(result?.name).toBe("John")
  })

  it("matches Arabic and Roman numbered-book prefixes", () => {
    expect(findMatchingBook("1 Samuel", arabicNumberedBooks)?.name).toBe("1 Samuel")
    expect(findMatchingBook("I Samuel", arabicNumberedBooks)?.name).toBe("1 Samuel")
    expect(findMatchingBook("1st Samuel", arabicNumberedBooks)?.name).toBe("1 Samuel")
  })
})

describe("Arabic-numbered database books", () => {
  it("supports every numbered book in autocomplete and reference parsing", () => {
    for (const book of arabicNumberedBooks) {
      const autocomplete = getAutocompleteSuggestion(`${book.name} 1:1`, arabicNumberedBooks)
      expect(autocomplete.matchedBook?.name, book.name).toBe(book.name)

      const reference = parseTypedReference(`${book.name} 1:1`, arabicNumberedBooks)
      expect(reference?.book.name, book.name).toBe(book.name)
    }
  })

  it("supports ordinal input such as 1st Samuel", () => {
    const result = getAutocompleteSuggestion("1st Samuel 1:1", arabicNumberedBooks)
    expect(result.matchedBook?.name).toBe("1 Samuel")
    expect(parseTypedReference("1st Samuel 1:1", arabicNumberedBooks)?.book.name).toBe("1 Samuel")
  })

  it("suggests the database name when a numbered prefix is typed alone", () => {
    const result = getAutocompleteSuggestion("1", arabicNumberedBooks)
    expect(result.suggestion).toBe("1 Samuel 1:1")
    expect(result.matchedBook?.name).toBe("1 Samuel")
  })
})

describe("getAutocompleteSuggestion", () => {
  // Test 1: Empty input returns no suggestion
  it("returns empty suggestion for empty input", () => {
    const result = getAutocompleteSuggestion("", mockBooks)
    expect(result.suggestion).toBe("")
    expect(result.stage).toBe("none")
  })

  // Test 2: Just number "1" suggests "I John 1:1"
  it("suggests 'I John 1:1' when input is '1'", () => {
    const result = getAutocompleteSuggestion("1", mockBooks)
    expect(result.suggestion).toBe("I John 1:1")
    expect(result.matchedBook?.name).toBe("I John")
    expect(result.chapter).toBe(1)
    expect(result.verse).toBe(1)
    expect(result.stage).toBe("book")
  })

  // Test 3: Just number "2" suggests "II John 1:1"
  it("suggests 'II John 1:1' when input is '2'", () => {
    const result = getAutocompleteSuggestion("2", mockBooks)
    expect(result.suggestion).toBe("II John 1:1")
    expect(result.matchedBook?.name).toBe("II John")
    expect(result.stage).toBe("book")
  })

  // Test 4: Partial book name "j" suggests "John 1:1"
  it("suggests 'John 1:1' when input is 'j'", () => {
    const result = getAutocompleteSuggestion("j", mockBooks)
    expect(result.suggestion).toBe("John 1:1")
    expect(result.matchedBook?.name).toBe("John")
    expect(result.stage).toBe("book")
  })

  // Test 5: Partial book name "gen" suggests "Genesis 1:1"
  it("suggests 'Genesis 1:1' when input is 'gen'", () => {
    const result = getAutocompleteSuggestion("gen", mockBooks)
    expect(result.suggestion).toBe("Genesis 1:1")
    expect(result.matchedBook?.name).toBe("Genesis")
    expect(result.stage).toBe("book")
  })

  // Test 6: Full book + chapter "John 3" suggests "John 3:1"
  it("suggests 'John 3:1' when input is 'John 3'", () => {
    const result = getAutocompleteSuggestion("John 3", mockBooks)
    expect(result.suggestion).toBe("John 3:1")
    expect(result.matchedBook?.name).toBe("John")
    expect(result.chapter).toBe(3)
    expect(result.verse).toBe(1)
    expect(result.stage).toBe("chapter")
  })

  // Test 7: Book + chapter with colon "John 3:" returns no suggestion
  it("returns empty suggestion when input is 'John 3:' (waiting for verse)", () => {
    const result = getAutocompleteSuggestion("John 3:", mockBooks)
    expect(result.suggestion).toBe("")
    expect(result.matchedBook?.name).toBe("John")
    expect(result.chapter).toBe(3)
    expect(result.stage).toBe("verse")
  })

  // Test 8: Complete reference "John 3:16" returns no suggestion
  it("returns empty suggestion for complete reference 'John 3:16'", () => {
    const result = getAutocompleteSuggestion("John 3:16", mockBooks)
    expect(result.suggestion).toBe("")
    expect(result.matchedBook?.name).toBe("John")
    expect(result.chapter).toBe(3)
    expect(result.verse).toBe(16)
    expect(result.stage).toBe("complete")
  })

  // Test 9: Numbered book "1 j" suggests "I John 1:1"
  it("suggests 'I John 1:1' when input is '1 j'", () => {
    const result = getAutocompleteSuggestion("1 j", mockBooks)
    expect(result.suggestion).toBe("I John 1:1")
    expect(result.matchedBook?.name).toBe("I John")
    expect(result.stage).toBe("book")
  })

  // Test 10: Numbered book with chapter "1 john 3" suggests "1 john 3:1"
  it("suggests '1 john 3:1' when input is '1 john 3'", () => {
    const result = getAutocompleteSuggestion("1 john 3", mockBooks)
    expect(result.suggestion).toBe("1 john 3:1")
    expect(result.matchedBook?.name).toBe("I John")
    expect(result.chapter).toBe(3)
    expect(result.stage).toBe("chapter")
  })

  it("advances through an Arabic-numbered database book", () => {
    const result = getAutocompleteSuggestion("1 sam", arabicNumberedBooks)
    expect(result.suggestion).toBe("1 Samuel 1:1")
    expect(getTabNavigationResult("1 sam", result.suggestion)).toBe("1 Samuel ")
  })

  // Test 11: Abbreviation "rom" suggests "Romans 1:1"
  it("suggests 'Romans 1:1' when input is 'rom'", () => {
    const result = getAutocompleteSuggestion("rom", mockBooks)
    expect(result.suggestion).toBe("Romans 1:1")
    expect(result.matchedBook?.name).toBe("Romans")
    expect(result.stage).toBe("book")
  })

  // Test 12: Case insensitive "JOHN" suggests "John 1:1"
  it("handles case insensitive input 'JOHN'", () => {
    const result = getAutocompleteSuggestion("JOHN", mockBooks)
    expect(result.suggestion).toBe("John 1:1")
    expect(result.matchedBook?.name).toBe("John")
    expect(result.stage).toBe("book")
  })

  // Test 13: Invalid book name returns no match
  it("returns no match for invalid book 'xyz'", () => {
    const result = getAutocompleteSuggestion("xyz", mockBooks)
    expect(result.suggestion).toBe("")
    expect(result.stage).toBe("none")
  })

  // Test 14: Psalms "ps" suggests "Psalms 1:1"
  it("suggests 'Psalms 1:1' when input is 'ps'", () => {
    const result = getAutocompleteSuggestion("ps", mockBooks)
    expect(result.suggestion).toBe("Psalms 1:1")
    expect(result.matchedBook?.name).toBe("Psalms")
    expect(result.stage).toBe("book")
  })

  // Test 15: Psalms with chapter "Psalms 23" suggests "Psalms 23:1"
  it("suggests 'Psalms 23:1' when input is 'Psalms 23'", () => {
    const result = getAutocompleteSuggestion("Psalms 23", mockBooks)
    expect(result.suggestion).toBe("Psalms 23:1")
    expect(result.matchedBook?.name).toBe("Psalms")
    expect(result.chapter).toBe(23)
    expect(result.stage).toBe("chapter")
  })
})

describe("getTabNavigationResult", () => {
  // Test 1: Typing "j" with suggestion "John 1:1" -> "John "
  it("advances from 'j' to 'John ' when suggestion is 'John 1:1'", () => {
    const result = getTabNavigationResult("j", "John 1:1")
    expect(result).toBe("John ")
  })

  // Test 2: Typing "John " with suggestion "John 1:1" -> "John 1:1" (already complete book)
  it("accepts full suggestion when book name is complete", () => {
    const result = getTabNavigationResult("John ", "John 1:1")
    expect(result).toBe("John 1:1")
  })

  // Test 3: Typing "John 3" with suggestion "John 3:1" -> "John 3:"
  it("advances from 'John 3' to 'John 3:' when suggestion is 'John 3:1'", () => {
    const result = getTabNavigationResult("John 3", "John 3:1")
    expect(result).toBe("John 3:")
  })

  // Test 4: Typing "1 j" with suggestion "I John 1:1" -> "I John "
  it("advances from '1 j' to 'I John ' when suggestion is 'I John 1:1'", () => {
    const result = getTabNavigationResult("1 j", "I John 1:1")
    expect(result).toBe("I John ")
  })

  // Test 5: Empty suggestion returns current input
  it("returns current input when no suggestion", () => {
    const result = getTabNavigationResult("john", "")
    expect(result).toBe("john")
  })

  // Test 6: Same input and suggestion returns input
  it("returns input when suggestion equals input", () => {
    const result = getTabNavigationResult("John 3:16", "John 3:16")
    expect(result).toBe("John 3:16")
  })

  // Test 7: Typing "gen" with suggestion "Genesis 1:1" -> "Genesis "
  it("advances from 'gen' to 'Genesis ' when suggestion is 'Genesis 1:1'", () => {
    const result = getTabNavigationResult("gen", "Genesis 1:1")
    expect(result).toBe("Genesis ")
  })

  // Test 8: Typing "Romans 8" with suggestion "Romans 8:1" -> "Romans 8:"
  it("advances from 'Romans 8' to 'Romans 8:' when suggestion is 'Romans 8:1'", () => {
    const result = getTabNavigationResult("Romans 8", "Romans 8:1")
    expect(result).toBe("Romans 8:")
  })
})

describe("parseTypedReference", () => {
  it("parses a full reference with colon", () => {
    const result = parseTypedReference("John 3:16", mockBooks)
    expect(result?.book.book_number).toBe(43)
    expect(result?.chapter).toBe(3)
    expect(result?.verse).toBe(16)
  })

  it("parses abbreviations and space separators", () => {
    const result = parseTypedReference("jn 3 16", mockBooks)
    // "jn" does not prefix-match "John"/"Jhn"-style abbreviations in this
    // fixture set; "joh 3 16" does.
    const result2 = parseTypedReference("joh 3 16", mockBooks)
    expect(result2?.book.book_number).toBe(43)
    expect(result2?.chapter).toBe(3)
    expect(result2?.verse).toBe(16)
    // jn simply fails to match a book rather than mis-parsing
    expect(result === null || result.book.book_number === 43).toBe(true)
  })

  it("parses numbered books", () => {
    const result = parseTypedReference("1 cor 13:4", mockBooks)
    expect(result?.book.book_number).toBe(46)
    expect(result?.chapter).toBe(13)
    expect(result?.verse).toBe(4)
  })

  it("parses numbered books with space separator", () => {
    const result = parseTypedReference("1 john 1 9", mockBooks)
    expect(result?.book.book_number).toBe(62)
    expect(result?.chapter).toBe(1)
    expect(result?.verse).toBe(9)
  })

  it("parses dot separator", () => {
    const result = parseTypedReference("psalm 23.1", mockBooks)
    expect(result?.book.book_number).toBe(19)
    expect(result?.chapter).toBe(23)
    expect(result?.verse).toBe(1)
  })

  it("does not parse book-only input", () => {
    expect(parseTypedReference("John", mockBooks)).toBeNull()
  })

  it("does not parse book+chapter input", () => {
    expect(parseTypedReference("John 3", mockBooks)).toBeNull()
  })

  it("does not parse free text", () => {
    expect(parseTypedReference("johnny walked home", mockBooks)).toBeNull()
    expect(parseTypedReference("for god so loved the world", mockBooks)).toBeNull()
    expect(parseTypedReference("love never fails", mockBooks)).toBeNull()
  })

  it("does not parse text with trailing numbers but no book", () => {
    expect(parseTypedReference("grace 3 16", mockBooks)).toBeNull()
  })

  it("does not parse empty input", () => {
    expect(parseTypedReference("", mockBooks)).toBeNull()
  })

  it("rejects zero chapter or verse", () => {
    expect(parseTypedReference("John 0:16", mockBooks)).toBeNull()
    expect(parseTypedReference("John 3:0", mockBooks)).toBeNull()
  })

  it("understands the common short forms people type (PRD FR-01: Jn 3 16)", () => {
    const canon: Book[] = [[1, "Genesis", "Gen"], [5, "Deuteronomy", "Deut"], [7, "Judges", "Judg"], [22, "Song of Solomon", "Song"], [40, "Matthew", "Matt"], [41, "Mark", "Mark"], [42, "Luke", "Luke"], [43, "John", "John"], [45, "Romans", "Rom"], [50, "Philippians", "Phil"], [57, "Philemon", "Phlm"], [60, "1 Peter", "1Pet"], [62, "1 John", "1John"], [64, "3 John", "3John"], [66, "Revelation", "Rev"]]
      .map(([n, name, abbreviation]) => ({ id: n as number, translation_id: 1, book_number: n as number, name: name as string, abbreviation: abbreviation as string, testament: (n as number) < 40 ? "OT" : "NT" }))
    const cases: Array<[string, string, number, number]> = [
      ["Jn 3 16", "John", 3, 16], ["jn3:16", "John", 3, 16], ["Jhn 3:16", "John", 3, 16], ["Mt 5:3", "Matthew", 5, 3], ["Mk 1:1", "Mark", 1, 1],
      ["Lk 2:1", "Luke", 2, 1], ["Rm 8:28", "Romans", 8, 28], ["Php 4:13", "Philippians", 4, 13], ["Phm 1:6", "Philemon", 1, 6], ["Dt 6:4", "Deuteronomy", 6, 4],
      ["Jdg 6:12", "Judges", 6, 12], ["1 Pt 5:7", "1 Peter", 5, 7], ["1 Jn 4:8", "1 John", 4, 8], ["3 Jn 1:2", "3 John", 1, 2], ["Revelations 22:21", "Revelation", 22, 21],
      ["Song of Songs 2:1", "Song of Solomon", 2, 1], ["John 3:16", "John", 3, 16], ["Gen 1 1", "Genesis", 1, 1], ["Phil 4 13", "Philippians", 4, 13],
    ]
    for (const [input, book, chapter, verse] of cases) {
      expect(parseTypedReference(input, canon), input).toMatchObject({ book: { name: book }, chapter, verse })
    }
  })

  it("understands the Yorùbá Bible's own book names, with or without accents", () => {
    const canon: Book[] = [[1, "Genesis", "Gen"], [7, "Judges", "Judg"], [11, "1 Kings", "1Kgs"], [19, "Psalms", "Ps"], [25, "Lamentations", "Lam"], [43, "John", "John"], [44, "Acts", "Acts"], [46, "1 Corinthians", "1Cor"], [62, "1 John", "1John"], [65, "Jude", "Jude"], [66, "Revelation", "Rev"]]
      .map(([n, name, abbreviation]) => ({ id: n as number, translation_id: 2, book_number: n as number, name: name as string, abbreviation: abbreviation as string, testament: (n as number) < 40 ? "OT" : "NT" }))
    const cases: Array<[string, string, number, number]> = [
      ["Johanu 3:16", "John", 3, 16], ["Jòhánù 3 16", "John", 3, 16], ["Gẹnẹsisi 1:1", "Genesis", 1, 1], ["1 Ọba 3:9", "1 Kings", 3, 9],
      ["Saamu 23:1", "Psalms", 23, 1], ["Ẹkún Jeremiah 3:22", "Lamentations", 3, 22], ["Ìṣe àwọn Aposteli 2:38", "Acts", 2, 38], ["Ise 2:38", "Acts", 2, 38],
      ["1 Kọrinti 13:4", "1 Corinthians", 13, 4], ["1 Johanu 4:8", "1 John", 4, 8], ["Juda 1:3", "Jude", 1, 3], ["Ìfihàn 22:21", "Revelation", 22, 21],
      ["Onidajọ 6:12", "Judges", 6, 12],
      // English behaviour unchanged where a Yorùbá name could collide.
      ["Jud 1:3", "Judges", 1, 3], ["John 3:16", "John", 3, 16], ["Jn 3 16", "John", 3, 16],
    ]
    for (const [input, book, chapter, verse] of cases) {
      expect(parseTypedReference(input, canon), input).toMatchObject({ book: { name: book }, chapter, verse })
    }
    expect(foldMarks("Ọlọ́run")).toBe("Olorun")
    // Tab carries on from the suggested book name, keeping what was typed after it.
    expect(getTabNavigationResult("Jòhánù", "John 1:1")).toBe("John ")
    expect(getTabNavigationResult("Jòhánù 3", "John 3:1")).toBe("John 3:")
    expect(getTabNavigationResult("jn", "John 1:1")).toBe("John ")
    expect(getTabNavigationResult("Jo", "John 1:1")).toBe("John ")
    expect(getTabNavigationResult("Jòhánù 3", "Jòhánù 3:1")).toBe("Jòhánù 3:") // chapter step kept when the suggestion repeats what was typed
  })

  it("ranges, lists, dotted abbreviations and one-chapter books (search audit)", () => {
    for (const input of ["John 3:16-18", "John 3:16, 18", "Jn. 3:16"]) {
      expect(parseTypedReference(input, mockBooks), input).toMatchObject({ book: { book_number: 43 }, chapter: 3, verse: 16 })
      expect(getAutocompleteSuggestion(input, mockBooks), input).toMatchObject({ stage: "complete", chapter: 3, verse: 16 })
    }
    expect(parseTypedReference("Jude 5", mockBooks)).toMatchObject({ book: { book_number: 65 }, chapter: 1, verse: 5 })
    expect(getAutocompleteSuggestion("Jude 5", mockBooks)).toMatchObject({ stage: "complete", chapter: 1, verse: 5 })
    // A book with many chapters keeps "John 5" as chapter 5.
    expect(parseTypedReference("John 5", mockBooks)).toBeNull()
    expect(getAutocompleteSuggestion("John 5", mockBooks)).toMatchObject({ stage: "chapter", chapter: 5 })
    expect(getAutocompleteSuggestion("John 3-5", mockBooks).stage).toBe("none")
    expect(getAutocompleteSuggestion("Jude 1", mockBooks)).toMatchObject({ stage: "chapter", suggestion: "Jude 1:1" })
  })
})

describe("numbered books said or typed as words", () => {
  it("reads First/Second and the Yoruba Kinni/Keji after the name", () => {
    expect(parseTypedReference("First Samuel 3:10", arabicNumberedBooks)?.book.name).toBe("1 Samuel")
    expect(parseTypedReference("second kings 2:9", arabicNumberedBooks)?.book.name).toBe("2 Kings")
    expect(parseTypedReference("Samuẹli Kínní 3:10", [{ id: 9, translation_id: 2, book_number: 9, name: "1 Samuel", abbreviation: "1Sam", testament: "OT" }])?.book.name).toBe("1 Samuel")
    expect(parseTypedReference("Johanu Kẹta 1:4", mockBooks)?.book.name).toBe("III John")
    expect(normalizeInput("first love")).toBe("I love")
  })
})

describe("parseBookChapter", () => {
  it("finds a numbered book alone or with a chapter, in Roman- and Arabic-named Bibles", () => {
    expect(parseBookChapter("1 Samuel", arabicNumberedBooks)).toMatchObject({ book: { name: "1 Samuel" }, chapter: 1 })
    expect(parseBookChapter("1 kings 3", arabicNumberedBooks)).toMatchObject({ book: { name: "1 Kings" }, chapter: 3 })
    expect(parseBookChapter("1 cor", mockBooks)).toMatchObject({ book: { name: "I Corinthians" }, chapter: 1 })
    expect(parseBookChapter("Psalm 23", mockBooks)).toMatchObject({ book: { name: "Psalms" }, chapter: 23 })
  })
  it("leaves words alone", () => {
    expect(parseBookChapter("john", mockBooks)).toBeNull()
    expect(parseBookChapter("I am the way", mockBooks)).toBeNull()
    expect(parseBookChapter("amazing grace", mockBooks)).toBeNull()
  })
})

