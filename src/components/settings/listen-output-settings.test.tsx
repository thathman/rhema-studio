// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { ListenOutputSettings } from "./listen-output-settings"
import { useSettingsStore } from "@/stores/settings-store"

/** #447: the private listening output is chosen by name and confirmed off the PA; the default is never offered. */
let element: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  ;(HTMLMediaElement.prototype as unknown as Record<string, unknown>).setSinkId = vi.fn()
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { enumerateDevices: vi.fn(async () => [{ kind: "audiooutput", deviceId: "default", label: "Default - Mixer" }, { kind: "audiooutput", deviceId: "hp", label: "Desk headphones" }]), addEventListener() {}, removeEventListener() {} } })
  useSettingsStore.setState({ auditionOutputId: "", auditionOutputLabel: "", auditionConfirmed: false })
  element = document.createElement("div")
  document.body.appendChild(element)
  root = createRoot(element)
})

afterEach(() => {
  act(() => root.unmount())
  element.remove()
  delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>).setSinkId
})

describe("Settings → Audio → Private listening (#447)", () => {
  it("offers named outputs only, and the PA confirmation once one is chosen", async () => {
    await act(async () => root.render(<ListenOutputSettings />))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    const select = element.querySelector<HTMLSelectElement>('select[aria-label="Private listening output"]')!
    expect([...select.options].map((o) => o.textContent)).toEqual(["None: Listen is off", "Desk headphones"])
    const confirm = element.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(confirm.disabled).toBe(true)
    expect(element.textContent).toContain("Choose a private listening output")

    await act(async () => {
      select.value = "hp"
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(useSettingsStore.getState()).toMatchObject({ auditionOutputId: "hp", auditionOutputLabel: "Desk headphones", auditionConfirmed: false })
    expect(element.textContent).toContain("is not connected to the PA or mixer")
    await act(async () => confirm.click())
    expect(useSettingsStore.getState().auditionConfirmed).toBe(true)
    expect(element.textContent).toContain("Library → Sounds can listen on Desk headphones")
  })

  it("says Listen is off when this app cannot choose an output at all", async () => {
    delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>).setSinkId
    await act(async () => root.render(<ListenOutputSettings />))
    expect(element.textContent).toContain("cannot send a sound to a chosen output")
    expect(element.querySelector<HTMLSelectElement>("select")!.disabled).toBe(true)
  })
})
