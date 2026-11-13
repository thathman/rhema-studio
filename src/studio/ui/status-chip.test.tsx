// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { StatusChip } from "@/studio/ui/status-chip"

async function render(node: React.ReactNode) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const el = document.createElement("div")
  await act(async () => createRoot(el).render(node))
  return el
}

describe("StatusChip (UX audit §5.5)", () => {
  it("says its state in words with a dot; error is a ring that does not pulse", async () => {
    const el = await render(<StatusChip tone="error" label="Camera: no signal" />)
    expect(el.textContent).toBe("Camera: no signal")
    const dot = el.querySelector("[aria-hidden]")!
    expect(dot.className).toContain("border-destructive")
    expect(dot.className).not.toContain("animate-pulse")
  })

  it("comes in two sizes and shows a chevron only when it opens something", async () => {
    const small = await render(<StatusChip tone="ok" label="On" size="sm" />)
    expect(small.firstElementChild!.className).toContain("h-6")
    expect(small.querySelectorAll("svg")).toHaveLength(0)
    const opener = await render(<StatusChip tone="live" label="REC 13:07" opens onClick={() => {}} />)
    expect(opener.querySelector("button")!.className).toContain("h-8")
    expect(opener.querySelectorAll("svg")).toHaveLength(1)
  })
})
