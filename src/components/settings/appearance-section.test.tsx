// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { ThemeProvider } from "@/components/theme-provider"
import { AppearanceSection } from "./appearance-section"

/** #447: Settings → Preferences → Appearance is the Desk menu's light/dark/system choice, one setting. */
let element: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia
  const store = new Map<string, string>([["theme-test", "light"]])
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) })
  element = document.createElement("div")
  document.body.appendChild(element)
  root = createRoot(element)
})

afterEach(() => {
  act(() => root.unmount())
  element.remove()
  vi.unstubAllGlobals()
})

describe("Settings → Appearance (#447)", () => {
  it("sets light, dark or system for this computer, saved where the Desk menu reads it", () => {
    act(() => root.render(<ThemeProvider storageKey="theme-test"><AppearanceSection /></ThemeProvider>))
    const radio = (name: string) => [...element.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent?.includes(name))!
    expect(radio("Light").getAttribute("aria-checked")).toBe("true")
    act(() => radio("Dark").click())
    expect(radio("Dark").getAttribute("aria-checked")).toBe("true")
    expect(localStorage.getItem("theme-test")).toBe("dark")
    expect(element.textContent).toContain("It does not change any screen")
  })
})
