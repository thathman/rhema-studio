// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}) }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { StarterPackChooser } from "./starter-pack"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
import { defaultBrandKit } from "@/lib/brand-kit"
import { DEFAULT_TICKER_STYLE } from "@/lib/ticker"
import { DEFAULT_STAGE_STYLE } from "@/lib/stage-style"
import { DEFAULT_LOWER_THIRD_STYLE } from "@/lib/lower-third-style"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"
import type { BroadcastOutput } from "@/types"

const out = (id: string, patch: Partial<BroadcastOutput> = {}): BroadcastOutput => ({ id, name: id === "main" ? "Main Display" : id, type: "display", themeId: "builtin-classic-dark", monitorIndex: 0, ndi: { sourceName: id, resolution: "r1080p", frameRate: "fps30", alphaMode: "noneOpaque" }, ...patch })
const button = (t: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(t)) as HTMLButtonElement | undefined
const click = async (t: string) => {
  const b = button(t)
  if (!b) throw new Error(`no button “${t}”`)
  await act(async () => b.click())
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
  document.body.replaceChildren()
  useSettingsStore.setState({ brandKit: { ...defaultBrandKit(), churchName: "Grace Chapel", colors: { primary: "#003366", accent: "#ffcc00", text: "#ffffff", background: "#001122" } } })
  useBroadcastStore.setState({
    themes: BUILTIN_THEMES, scenes: [], lowerThirdStyles: [DEFAULT_LOWER_THIRD_STYLE], tickerStyle: DEFAULT_TICKER_STYLE, stageStyle: DEFAULT_STAGE_STYLE,
    outputs: [out("main"), out("projector"), out("stage", { role: "stage" })],
    outputStatus: { projector: { previewOpen: true, ndiActive: false } },
  })
})

async function render() {
  const el = document.createElement("div")
  document.body.appendChild(el)
  await act(async () => createRoot(el).render(<StarterPackChooser />))
  return el
}

describe("setup starter looks (#298 S3.2, S3.3)", () => {
  it("choosing a family is a draft with a preview; Apply asks first, then adds the looks and sets only outputs that are off", async () => {
    const el = await render()
    const before = structuredClone({ themes: useBroadcastStore.getState().themes, outputs: useBroadcastStore.getState().outputs })
    await click("Church Classic")
    expect(el.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toContain("Church Classic")
    // Rendered previews of the church-colour copies, and the plan in words.
    expect([...el.querySelectorAll('[role="img"]')].map((x) => x.getAttribute("aria-label"))).toContain("Preview: Classic · Scripture · Grace Chapel")
    expect(el.textContent).toContain("Main Display: gets the full-screen looks (it is off)")
    expect(el.textContent).toContain("projector: left as it is, on now: nothing on air changes")
    expect(el.textContent).toContain("stage: left as it is, a stage display: it has its own look")
    // Nothing saved yet.
    expect(useBroadcastStore.getState().themes).toHaveLength(before.themes.length)
    await click("Apply…")
    expect(el.querySelector('[role="alertdialog"]')?.textContent).toContain("set on Main Display, which is off")
    expect(useBroadcastStore.getState().themes).toHaveLength(before.themes.length)
    await click("Cancel")
    expect(el.querySelector('[role="alertdialog"]')).toBeNull()
    expect(useBroadcastStore.getState().themes).toHaveLength(before.themes.length)

    await click("Apply…")
    await click("Apply starter looks")
    const s = useBroadcastStore.getState()
    expect(s.themes).toHaveLength(before.themes.length + 5)
    expect(s.scenes).toHaveLength(2)
    expect(s.lowerThirdStyles).toHaveLength(2)
    expect(s.tickerStyle.libraryLookId).toBe("look-classic-ticker")
    expect(s.stageStyle.libraryLookId).toBe("look-classic-stage")
    const main = s.outputs.find((o) => o.id === "main")!
    expect(s.themes.find((t) => t.id === main.themeId)?.libraryLookId).toBe("look-classic-bible-full")
    // The output that is on, and the stage output, are exactly as they were.
    expect(s.outputs.find((o) => o.id === "projector")).toEqual(before.outputs.find((o) => o.id === "projector"))
    expect(s.outputs.find((o) => o.id === "stage")).toEqual(before.outputs.find((o) => o.id === "stage"))
    expect(el.querySelector('[role="status"]')?.textContent).toContain("Added the Church Classic looks and set them on Main Display.")
  })

  it("an output switched on after the plan was shown is left alone at Apply", async () => {
    await render()
    await click("Broadcast Clean")
    await click("Apply…")
    useBroadcastStore.setState({ outputStatus: { projector: { previewOpen: true, ndiActive: false }, main: { previewOpen: true, ndiActive: false } } })
    const main = structuredClone(useBroadcastStore.getState().outputs.find((o) => o.id === "main"))
    await click("Apply starter looks")
    expect(useBroadcastStore.getState().outputs.find((o) => o.id === "main")).toEqual(main)
    expect(useBroadcastStore.getState().scenes).toHaveLength(2)
  })
})
