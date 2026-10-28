import { describe, expect, it } from "vitest"
import { defaultRange, usageCsv } from "./song-usage"

describe("song usage report", () => {
  it("writes a CSV with quoting and no spreadsheet formulas", () => {
    const csv = usageCsv([
      { song_id: "a", title: "Holy, Holy, Holy", hymn: false, hymn_numbers: [], authors: "Reginald Heber", ccli_number: null, licence: "public_domain", services: 3, last_date: "2026-10-11" },
      { song_id: "h", title: "Amazing Grace", hymn: true, hymn_numbers: ["CAC 245", "CAC V12"], authors: "John Newton", ccli_number: null, licence: "public_domain", services: 2, last_date: "2026-10-18" },
      { song_id: "b", title: "=HYPERLINK(\"x\")", hymn: false, hymn_numbers: [], authors: "", ccli_number: "22025", licence: "ccli", services: 1, last_date: "2026-10-04" },
    ], "2026-04-21", "2026-10-21")
    expect(csv.split("\n")).toEqual([
      "# Song usage 2026-04-21 to 2026-10-21 (saved services with a date)",
      "Type,Title,Hymn numbers,Authors,CCLI song number,Licence,Services,Last used",
      'Song,"Holy, Holy, Holy",,Reginald Heber,,public_domain,3,2026-10-11',
      "Hymn,Amazing Grace,CAC 245; CAC V12,John Newton,,public_domain,2,2026-10-18",
      `Song,"'=HYPERLINK(""x"")",,,22025,ccli,1,2026-10-04`,
      "",
    ])
  })

  it("defaults to the last six months", () => {
    expect(defaultRange(new Date(2026, 9, 21))).toEqual({ from: "2026-04-21", to: "2026-10-21" })
  })
})
