// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { keepFocusInList } from "./keep-focus"

const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)))

describe("focus after removing a list item", () => {
  it("moves to the same control of the item now in its place, or the last one", async () => {
    document.body.innerHTML = `<ul>${["a", "b", "c"].map((x) => `<li><button aria-label="Remove ${x}">x</button></li>`).join("")}</ul>`
    const list = document.querySelector("ul")!
    const b = list.children[1].querySelector("button")!
    keepFocusInList(b, 'button[aria-label^="Remove "]')
    list.children[1].remove() // what the store update does
    await frame()
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Remove c")
    const c = list.children[1].querySelector("button")!
    keepFocusInList(c, 'button[aria-label^="Remove "]')
    list.children[1].remove()
    await frame()
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Remove a")
  })
})
