import { describe, expect, it } from "vitest"
import { feedPageOutdated, feedScriptName } from "./feed-page-version"

const page = (name: string) => `<html><head><script type="module" crossorigin src="/assets/${name}"></script></head></html>`
const running = "https://192.168.3.90:8081/assets/feed-NW1eyKrK.js"

describe("feed page after a host update", () => {
  it("reads the build's script name from the served page", () => {
    expect(feedScriptName(page("feed-NW1eyKrK.js"))).toBe("feed-NW1eyKrK.js")
    expect(feedScriptName("<html>feed page</html>")).toBeNull()
  })

  it("is out of date only when the host serves another build", () => {
    expect(feedPageOutdated(page("feed-NW1eyKrK.js"), running)).toBe(false)
    expect(feedPageOutdated(page("feed-D532YLXl.js"), running)).toBe(true)
  })

  it("never reloads on a guess", () => {
    expect(feedPageOutdated("<html>feed page</html>", running)).toBe(false)
    expect(feedPageOutdated(page("feed-D532YLXl.js"), "http://localhost:1420/src/feed.ts")).toBe(false)
  })
})
