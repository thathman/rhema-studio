import { describe, expect, it } from "vitest"
import { announcementBody } from "./announcement"

describe("announcement body", () => {
  it("puts when · where above the details and skips what is empty", () => {
    expect(announcementBody("Friday 6 pm", "Main hall", "Bring a friend\nAsk Tolu")).toBe("Friday 6 pm · Main hall\nBring a friend\nAsk Tolu")
    expect(announcementBody("", "Main hall", "")).toBe("Main hall")
    expect(announcementBody("  ", "", "details")).toBe("details")
    expect(announcementBody("", "", "")).toBe("")
  })
})
