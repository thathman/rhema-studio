import { describe, expect, it } from "vitest"
import { defaultRange, usageCsv } from "./song-usage"

describe("song usage report", () => {
  it("writes a CSV with quoting and no spreadsheet formulas", () => {
    const csv = usageCsv([
      { song_id: "a", title: "Holy, Holy, Holy", authors: "Reginald Heber", ccli_number: null, licence: "public_domain", services: 3, last_date: "2026-10-11" },
      { song_id: "b", title: "=HYPERLINK(\"x\")", authors: "", ccli_number: "22025", licence: "ccli", services: 1, last_date: "2026-10-04" },
    ], "2026-04-21", "2026-10-21")
    expect(csv.split("\n")).toEqual([
      "# Song usage 2026-04-21 to 2026-10-21 (saved services with a date)",
      "Title,Authors,CCLI song number,Licence,Services,Last used",
      '"Holy, Holy, Holy",Reginald Heber,,public_domain,3,2026-10-11',
      `"'=HYPERLINK(""x"")",,22025,ccli,1,2026-10-04`,
      "",
    ])
  })

  it("defaults to the last six months", () => {
    expect(defaultRange(new Date(2026, 9, 21))).toEqual({ from: "2026-04-21", to: "2026-10-21" })
  })
})
