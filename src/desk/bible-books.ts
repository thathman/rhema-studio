import type { Book } from "@/types/bible"

/**
 * The 66 books by their standard numbers (1 Genesis … 66 Revelation), for the browser desk's Bible
 * block to read a typed reference ("Romans 8:28", "Jn 3:16"). The installed app reads these from its
 * own Bible database; a browser has none, and the host's lookups take book numbers, which are the
 * same in every translation. Only names: every verse still comes from the host.
 */
const NAMES: readonly (readonly [string, string])[] = [
  ["Genesis", "Gen"], ["Exodus", "Exod"], ["Leviticus", "Lev"], ["Numbers", "Num"], ["Deuteronomy", "Deut"],
  ["Joshua", "Josh"], ["Judges", "Judg"], ["Ruth", "Ruth"], ["1 Samuel", "1Sam"], ["2 Samuel", "2Sam"],
  ["1 Kings", "1Kgs"], ["2 Kings", "2Kgs"], ["1 Chronicles", "1Chr"], ["2 Chronicles", "2Chr"], ["Ezra", "Ezra"],
  ["Nehemiah", "Neh"], ["Esther", "Esth"], ["Job", "Job"], ["Psalms", "Ps"], ["Proverbs", "Prov"],
  ["Ecclesiastes", "Eccl"], ["Song of Solomon", "Song"], ["Isaiah", "Isa"], ["Jeremiah", "Jer"], ["Lamentations", "Lam"],
  ["Ezekiel", "Ezek"], ["Daniel", "Dan"], ["Hosea", "Hos"], ["Joel", "Joel"], ["Amos", "Amos"],
  ["Obadiah", "Obad"], ["Jonah", "Jonah"], ["Micah", "Mic"], ["Nahum", "Nah"], ["Habakkuk", "Hab"],
  ["Zephaniah", "Zeph"], ["Haggai", "Hag"], ["Zechariah", "Zech"], ["Malachi", "Mal"],
  ["Matthew", "Matt"], ["Mark", "Mark"], ["Luke", "Luke"], ["John", "John"], ["Acts", "Acts"],
  ["Romans", "Rom"], ["1 Corinthians", "1Cor"], ["2 Corinthians", "2Cor"], ["Galatians", "Gal"], ["Ephesians", "Eph"],
  ["Philippians", "Phil"], ["Colossians", "Col"], ["1 Thessalonians", "1Thess"], ["2 Thessalonians", "2Thess"], ["1 Timothy", "1Tim"],
  ["2 Timothy", "2Tim"], ["Titus", "Titus"], ["Philemon", "Phlm"], ["Hebrews", "Heb"], ["James", "Jas"],
  ["1 Peter", "1Pet"], ["2 Peter", "2Pet"], ["1 John", "1John"], ["2 John", "2John"], ["3 John", "3John"],
  ["Jude", "Jude"], ["Revelation", "Rev"],
]

export const DESK_BIBLE_BOOKS: readonly Book[] = NAMES.map(([name, abbreviation], i) => ({
  id: i + 1,
  translation_id: 0,
  book_number: i + 1,
  name,
  abbreviation,
  testament: i < 39 ? "OT" : "NT",
}))
