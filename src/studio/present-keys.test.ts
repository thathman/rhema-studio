// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { keyToPresentAction, shouldIgnoreKeyboard } from "./present-keys"

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
    document.body.innerHTML = '<div role="menu"><button id="in-menu">Run</button></div><button id="plain">x</button>'
    expect(shouldIgnoreKeyboard(document.getElementById("in-menu"))).toBe(true)
    expect(shouldIgnoreKeyboard(document.getElementById("plain"))).toBe(false)
    document.body.insertAdjacentHTML("beforeend", '<div role="dialog" data-state="open"></div>')
    expect(shouldIgnoreKeyboard(document.getElementById("plain"))).toBe(true)
    document.body.innerHTML = ""
  })
})

