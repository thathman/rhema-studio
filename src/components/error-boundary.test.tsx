// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { ErrorBoundary } from "./error-boundary"

function Broken(): never {
  throw new Error("boom")
}

describe("error boundary (a failure cannot blank the window)", () => {
  it("one failing part shows a note; its neighbours keep rendering", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const el = document.createElement("div")
    const root = createRoot(el)
    await act(async () => {
      root.render(
        <>
          <ErrorBoundary name="the Present view"><Broken /></ErrorBoundary>
          <p>still here</p>
          <ErrorBoundary name="the stage display" quiet><Broken /></ErrorBoundary>
        </>,
      )
    })
    expect(el.textContent).toContain("Something went wrong in the Present view.")
    expect(el.textContent).toContain("still here")
    expect(el.textContent).not.toContain("stage display")
    act(() => root.unmount())
    spy.mockRestore()
  })
})
