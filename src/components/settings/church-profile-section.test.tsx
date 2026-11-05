// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { ChurchProfileSection } from "./church-profile-section"
import { useSettingsStore } from "@/stores/settings-store"
import { useSettingsDialogStore } from "@/lib/settings-dialog"

/** #447: Settings → Church and profile corrects what setup filled in, without running setup again. */
let element: HTMLDivElement
let root: Root
const initial = useSettingsStore.getState()

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  element = document.createElement("div")
  document.body.appendChild(element)
  root = createRoot(element)
  useSettingsStore.setState({ brandKit: { ...initial.brandKit, churchName: "Christ Apostolic Church" }, operatorName: "Tolu" })
})

afterEach(() => {
  act(() => root.unmount())
  element.remove()
  useSettingsStore.setState({ brandKit: initial.brandKit, operatorName: initial.operatorName })
})

function type(input: HTMLInputElement, text: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("Settings → Church and profile (#447)", () => {
  it("edits the church's name (as Home reads it) and the operator's, in the same fields as setup", () => {
    act(() => root.render(<ChurchProfileSection />))
    const church = element.querySelector<HTMLInputElement>("#settings-church-name")!
    const operator = element.querySelector<HTMLInputElement>("#settings-operator-name")!
    expect(church.value).toBe("Christ Apostolic Church")
    expect(operator.value).toBe("Tolu")

    type(church, "Christ Apostolic Church, Òkè-Ìgbàlà")
    type(operator, "Femi")
    expect(useSettingsStore.getState().brandKit.churchName).toBe("Christ Apostolic Church, Òkè-Ìgbàlà")
    expect(useSettingsStore.getState().operatorName).toBe("Femi")
    // Home's heading, previewed as setup does, with the accents kept.
    expect(element.textContent).toContain("Christ Apostolic Church, Òkè-Ìgbàlà workspace")
    expect(element.textContent).toContain("Nothing here changes what is on the screens")
    // Its own ids: setup can open over Settings without doubling the wizard's fields.
    expect(element.querySelector("#setup-church-name")).toBeNull()
  })

  it("leaving after a rename does not rebuild the brand looks (that is Design → Brand kit's)", async () => {
    const { useBroadcastStore } = await import("@/stores/broadcast-store")
    const apply = vi.spyOn(useBroadcastStore.getState(), "applyBrandKit")
    useBroadcastStore.setState({ themes: useBroadcastStore.getState().themes.map((t, i) => (i === 0 ? { ...t, brandManaged: true } : t)) })
    act(() => root.render(<ChurchProfileSection />))
    type(element.querySelector<HTMLInputElement>("#settings-church-name")!, "New name")
    act(() => root.render(<div />))
    expect(apply).not.toHaveBeenCalled()
    apply.mockRestore()
  })

  it("joining another computer goes to Connections and closes Settings", () => {
    useSettingsDialogStore.setState({ isOpen: true })
    act(() => root.render(<ChurchProfileSection />))
    const join = [...element.querySelectorAll("button")].find((b) => b.textContent?.includes("join another one"))!
    act(() => join.click())
    expect(useSettingsDialogStore.getState().isOpen).toBe(false)
  })
})
