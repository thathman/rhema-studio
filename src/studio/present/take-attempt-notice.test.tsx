import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { TakeAttemptNotice } from "./take-attempt-notice"

const textOnly = (html: string) => html.replace(/<[^>]*>/g, "")

describe("Take attempt status", () => {
  it("announces a pending Take separately from the on-air program", () => {
    const html = renderToStaticMarkup(<TakeAttemptNotice attempts={[{ id: 1, reference: "Psalm 23", status: "pending", by: "Main desk" }]} />)

    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    expect(textOnly(html)).toContain("Take pending: Psalm 23 · by Main desk")
  })

  it("makes failed, succeeded and superseded results explicit", () => {
    const render = (status: "failed" | "succeeded" | "superseded") => renderToStaticMarkup(<TakeAttemptNotice attempts={[{ id: 2, reference: "Amazing Grace", status }]} />)

    expect(textOnly(render("failed"))).toContain("Take failed: Amazing Grace")
    expect(textOnly(render("succeeded"))).toContain("Take succeeded: Amazing Grace")
    expect(textOnly(render("superseded"))).toContain("Take superseded: Amazing Grace")
  })
})
