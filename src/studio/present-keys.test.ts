// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { keyToPresentAction, shouldIgnoreKeyboard, isClickerKey } from "./present-keys"

const key = (key: string, mods: Partial<{ shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) => ({
  key,
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...mods,
})

describe("keyToPresentAction", () => {
  it("maps arrows and page keys", () => {
    expect(keyToPresentAction(key("ArrowRight"))).toBe("next")
    expect(keyToPresentAction(key("PageDown"))).toBe("next")
    expect(keyToPresentAction(key("ArrowLeft"))).toBe("prev")
    expect(keyToPresentAction(key("PageUp"))).toBe("prev")
  })

  it("escape clears, shift+escape restores", () => {
    expect(keyToPresentAction(key("Escape"))).toBe("clear")
    expect(keyToPresentAction(key("Escape", { shiftKey: true }))).toBe("restore")
    expect(keyToPresentAction(key("ArrowRight", { shiftKey: true }))).toBe("verseNext")
    expect(keyToPresentAction(key("PageUp", { shiftKey: true }))).toBe("versePrev")
  })

  it("Shift+T takes or stops the ticker; a plain T does nothing (#187)", () => {
    expect(keyToPresentAction(key("T", { shiftKey: true }))).toBe("ticker")
    expect(keyToPresentAction(key("t"))).toBeNull()
    expect(keyToPresentAction(key("T", { shiftKey: true, metaKey: true }))).toBeNull()
  })

  it("ignores modifier combos and unknown keys", () => {
    expect(keyToPresentAction(key("ArrowRight", { metaKey: true }))).toBeNull()
    expect(keyToPresentAction(key("ArrowRight", { ctrlKey: true }))).toBeNull()
    expect(keyToPresentAction(key("a"))).toBeNull()
    expect(keyToPresentAction(key("Enter"))).toBeNull()
  })
})

describe("shouldIgnoreKeyboard", () => {
  const el = (tagName: string, extra: Partial<HTMLElement> = {}) =>
    ({ tagName, isContentEditable: false, getAttribute: () => null, ...extra }) as unknown as HTMLElement

  it("ignores text fields and editable elements", () => {
    expect(shouldIgnoreKeyboard(el("INPUT"))).toBe(true)
    expect(shouldIgnoreKeyboard(el("TEXTAREA"))).toBe(true)
    expect(shouldIgnoreKeyboard(el("SELECT"))).toBe(true)
    expect(shouldIgnoreKeyboard(el("DIV", { isContentEditable: true }))).toBe(true)
    expect(shouldIgnoreKeyboard(el("DIV", { getAttribute: () => "combobox" }))).toBe(true)
  })

  it("lets buttons and body through", () => {
    expect(shouldIgnoreKeyboard(el("BUTTON"))).toBe(false)
    expect(shouldIgnoreKeyboard(el("BODY"))).toBe(false)
    expect(shouldIgnoreKeyboard(null)).toBe(false)
  })

  it("ignores keys inside a dialog, menu or popover, and while a modal is open (RG-09)", () => {
    document.body.innerHTML = '<div role="menu"><button id="in-menu">Run</button></div><div role="dialog" data-slot="popover-content" data-state="open"><button id="in-popover">Play</button></div><button id="plain">x</button>'
    expect(shouldIgnoreKeyboard(document.getElementById("in-menu"), "ArrowRight")).toBe(true)
    expect(shouldIgnoreKeyboard(document.getElementById("in-popover"), "ArrowRight")).toBe(true)
    // A presenter clicker still steps from an open popover (the popover is not modal).
    expect(shouldIgnoreKeyboard(document.getElementById("in-popover"), "PageDown")).toBe(false)
    expect(shouldIgnoreKeyboard(document.getElementById("plain"), "ArrowRight")).toBe(false)
    document.body.insertAdjacentHTML("beforeend", '<div role="dialog" data-slot="dialog-content" data-state="open"></div>')
    expect(shouldIgnoreKeyboard(document.getElementById("plain"), "PageDown")).toBe(true)
    document.body.innerHTML = ""
  })
})

describe("the presenter clicker (#411, owner decision 5 Nov)", () => {
  it("is plain PageUp/PageDown, and passes a popover but not a list or menu, which page themselves", () => {
    const plain = { shiftKey: false, metaKey: false, ctrlKey: false, altKey: false }
    expect(isClickerKey({ key: "PageDown", ...plain })).toBe(true)
    expect(isClickerKey({ key: "ArrowRight", ...plain })).toBe(false)
    expect(isClickerKey({ key: "PageDown", ...plain, shiftKey: true })).toBe(false)
    const popover = document.createElement("div")
    popover.setAttribute("role", "dialog")
    const inPopover = popover.appendChild(document.createElement("button"))
    const list = popover.appendChild(document.createElement("div"))
    list.setAttribute("role", "listbox")
    const option = list.appendChild(document.createElement("div"))
    document.body.appendChild(popover)
    expect(shouldIgnoreKeyboard(inPopover, "PageDown")).toBe(false)
    expect(shouldIgnoreKeyboard(option, "PageDown")).toBe(true)
    expect(shouldIgnoreKeyboard(inPopover, "ArrowRight")).toBe(true)
    // A text field in a popover (the stage message, a timer's name) wins over the clicker.
    const field = popover.appendChild(document.createElement("input"))
    expect(shouldIgnoreKeyboard(field, "PageDown")).toBe(true)
    popover.remove()
  })
})
