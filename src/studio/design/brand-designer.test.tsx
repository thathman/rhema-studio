// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"
import { applyBrandKit, defaultBrandKit, MANAGED_THEME_IDS } from "@/lib/brand-kit"
import { BrandDesigner } from "./brand-designer"

let root: Root | null = null

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

async function render() {
  const element = document.createElement("div")
  document.body.appendChild(element)
  root = createRoot(element)
  await act(async () => root!.render(<BrandDesigner />))
  return element
}

function buttonNamed(name: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find((candidate) => candidate.textContent?.includes(name))
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Could not find button ${name}`)
  return button
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const kit = { ...defaultBrandKit(), churchName: "Grace Chapel" }
  useSettingsStore.setState({ brandKit: kit })
  const broadcast = useBroadcastStore.getState()
  const outputs = [{ ...broadcast.outputs[0], id: "sanctuary", name: "Sanctuary screen", themeId: MANAGED_THEME_IDS.scripture, themeFor: {} }]
  useBroadcastStore.setState({
    themes: applyBrandKit(kit, []),
    outputs,
    outputStatus: { sanctuary: { previewOpen: true, ndiActive: false } },
  })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

describe("Brand Kit apply review", () => {
  it("shows updated themes and active outputs, while Cancel leaves saved state unchanged", async () => {
    const initialKit = useSettingsStore.getState().brandKit
    const initialThemes = useBroadcastStore.getState().themes
    const element = await render()

    await act(async () => {
      setInputValue(element.querySelector<HTMLInputElement>('input[placeholder="Grace Chapel"]')!, "New Dawn Chapel")
    })
    await act(async () => buttonNamed("Apply to themes").click())

    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain("New Dawn Chapel · Scripture · update")
    expect(dialog.textContent).toContain("Sanctuary screen · active now")
    expect(dialog.textContent).toContain("Cancel keeps the saved Brand Kit and themes unchanged")

    await act(async () => buttonNamed("Cancel").click())
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(useSettingsStore.getState().brandKit).toEqual(initialKit)
    expect(useBroadcastStore.getState().themes).toEqual(initialThemes)
  })

  it("applies the reviewed Brand Kit only after explicit confirmation", async () => {
    const element = await render()
    await act(async () => {
      setInputValue(element.querySelector<HTMLInputElement>('input[placeholder="Grace Chapel"]')!, "New Dawn Chapel")
    })
    await act(async () => buttonNamed("Apply to themes").click())

    expect(useSettingsStore.getState().brandKit.churchName).toBe("Grace Chapel")
    expect(useBroadcastStore.getState().themes.find((theme) => theme.id === MANAGED_THEME_IDS.scripture)?.name).toBe("Grace Chapel · Scripture")

    await act(async () => buttonNamed("Apply Brand Kit").click())

    expect(useSettingsStore.getState().brandKit.churchName).toBe("New Dawn Chapel")
    expect(useBroadcastStore.getState().themes.find((theme) => theme.id === MANAGED_THEME_IDS.scripture)?.name).toBe("New Dawn Chapel · Scripture")
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})
