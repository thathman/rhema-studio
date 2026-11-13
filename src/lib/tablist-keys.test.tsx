// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { act, useState } from "react"
import { createRoot } from "react-dom/client"
import { tablistKeys } from "./tablist-keys"

function Row() {
  const [on, setOn] = useState("a")
  return (
    <div role="tablist" aria-label="Row" onKeyDown={tablistKeys}>
      {["a", "b", "c"].map((id) => <button key={id} type="button" role="tab" aria-selected={on === id} onClick={() => setOn(id)}>{id}</button>)}
    </div>
  )
}

/** UX audit X2: hand-built tab rows move with the arrow keys like the shared Tabs. */
describe("tablistKeys", () => {
  it("moves and selects with →/←, wraps, and jumps with Home/End", async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => root.render(<Row />))
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    const list = host.querySelector('[role="tablist"]')!
    const press = async (key: string) => act(async () => { list.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })) })
    const selected = () => tabs.find((t) => t.getAttribute("aria-selected") === "true")?.textContent
    tabs[0].focus()
    await press("ArrowRight")
    expect(selected()).toBe("b")
    expect(document.activeElement).toBe(tabs[1])
    await press("End")
    expect(selected()).toBe("c")
    await press("ArrowRight")
    expect(selected()).toBe("a")
    await press("ArrowLeft")
    expect(selected()).toBe("c")
    await press("Home")
    expect(selected()).toBe("a")
    await act(async () => root.unmount())
  })
})
