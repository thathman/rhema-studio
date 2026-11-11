// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async () => () => {}) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { useJoin } from "@/stores/join-store"
import { JoinedDesk, OperatorsPanel } from "@/studio/production/operators-panel"
import { DESK_PAGES } from "@/studio/production/desk-pages"
import { JoinedDeskRoute } from "@/studio/shell/joined-desk-route"
import { showsJoinedDesk, useShellStore } from "@/studio/shell-store"
import { useProductionTab } from "@/studio/production/production-tab"
import type { LiveStateV1 } from "@/lib/live-state"

/** #813 F2 / #846 G2: a joined computer's Live page is its role's own desk page. */
const live: LiveStateV1 = {
  v: 1, at: 0, church: "CAC", service: { id: "s1", title: "Sunday", approved_revision: null }, program: { onAir: false, reference: null, rehearsal: false },
  sources: [{ id: "bible", reference: "Romans 8:28", on: true, revision: 1 }],
  event: { mode: "own", currentId: null }, rundown: [{ id: "w", reference: "Welcome", plannedMinutes: 5 }], timing: null, stageMessage: "",
  scenes: [{ id: "split", name: "Sermon split" }], outputs: [{ id: "main", name: "Projector", sceneId: null }], notices: [],
}

const roots: Root[] = []
afterEach(() => {
  act(() => { for (const root of roots.splice(0)) root.unmount() })
  document.body.replaceChildren()
})

async function render(node: React.ReactNode, role: string, state: LiveStateV1 = live, outputScope?: string[]) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useJoin.setState({ status: "connected", me: { name: "Op", role, ...(outputScope ? { outputScope } : {}) }, live: state, receivedAt: performance.now(), clockSkewMs: 0, error: null, paused: false, note: null })
  const el = document.createElement("div")
  document.body.appendChild(el)
  const root = createRoot(el)
  roots.push(root)
  await act(async () => root.render(node))
  return el
}

describe("the joined desk is this computer's Live page", () => {
  it("shows Live as the desk only while joined, and this computer's console when asked", () => {
    expect(showsJoinedDesk("off", "present", "desk")).toBe(false)
    // Only once the host accepted this computer: connecting or refused keeps the normal shell.
    expect(showsJoinedDesk("connecting", "present", "desk")).toBe(false)
    expect(showsJoinedDesk("refused", "present", "desk")).toBe(false)
    expect(showsJoinedDesk("connected", "present", "desk")).toBe(true)
    expect(showsJoinedDesk("reconnecting", "production", "desk")).toBe(true)
    expect(showsJoinedDesk("connected", "present", "console")).toBe(false)
    expect(showsJoinedDesk("connected", "prepare", "desk")).toBe(false)
  })

  it("puts each role's work first and the service, Talk and Notices beside it", async () => {
    const cases: Array<[string, string[]]> = [
      ["bible", ["Bible desk"]],
      ["worship", ["Worship desk"]],
      ["timekeeper", ["Event clock desk"]],
      ["stage", ["Stage desk"]],
      ["camera", ["Camera desk", "Scenes desk"]],
      ["obs", ["OBS desk"]],
      ["editor", ["Prepare desk", "Scenes desk"]],
    ]
    for (const [role, work] of cases) {
      const el = await render(<JoinedDesk layout="page" />, role)
      const page = el.querySelector(`[data-desk-page="${role}"]`)!
      expect(page).not.toBeNull()
      expect(page.querySelector("h1")?.textContent).toBe("Sunday")
      expect(page.textContent).toContain(DESK_PAGES[role]!.title)
      const main = page.querySelector(`[aria-label="${DESK_PAGES[role]!.title} desk"]`)!
      for (const label of work) expect(main.querySelector(`[aria-label="${label}"]`)).not.toBeNull()
      const side = page.querySelector('[aria-label="Service and crew"]')!
      expect(side.querySelector('[aria-label="Talk desk"]')).not.toBeNull()
      expect(side.querySelector('[aria-label="Notices desk"]')).not.toBeNull()
      expect(side.querySelector('[aria-label="Run of show (read only)"]')).not.toBeNull()
      act(() => roots.pop()!.unmount())
    }
  })

  it("keeps On the screens beside the Timekeeper and Editor work", async () => {
    for (const role of ["timekeeper", "editor"]) {
      const el = await render(<JoinedDesk layout="page" />, role)
      expect(el.querySelector('[aria-label="Service and crew"] [aria-label="On the screens"]')).not.toBeNull()
      act(() => roots.pop()!.unmount())
    }
  })

  it("gives Screens its named outputs, sources and scenes, and the upcoming graphics beside them", async () => {
    const screensLive: LiveStateV1 = { ...live, outputMap: [{ id: "main", name: "Projector", role: "congregation", on: true }] as LiveStateV1["outputMap"] }
    const el = await render(<JoinedDesk layout="page" />, "screens", screensLive, ["main"])
    const main = el.querySelector('[aria-label="Screens & graphics desk"]')!
    expect(main.querySelector('[aria-label="Output map"]')).not.toBeNull()
    expect(main.querySelector('[aria-label="Scenes desk"]')).not.toBeNull()
    expect(el.querySelector('[aria-label="Service and crew"] [aria-label="On the screens"]')).not.toBeNull()
  })

  it("gives Present and Configure the director's board and every desk in two columns", async () => {
    for (const [role, title] of [["present", "Main presenter"], ["configure", "Configure"]] as const) {
      const el = await render(<JoinedDesk layout="page" />, role)
      const main = el.querySelector(`[aria-label="${title} desk"]`)!
      expect(main.className).toContain("2xl:grid-cols-2")
      for (const label of ["Director's board", "Bible desk", "Worship desk", "Scenes desk", "Stage desk"]) expect(main.querySelector(`[aria-label="${label}"]`)).not.toBeNull()
      expect(el.querySelector('[aria-label="Service and crew"] [aria-label="Event clock desk"]')).not.toBeNull()
      act(() => roots.pop()!.unmount())
    }
  })

  it("gives an OBS companion what its card showed: the screens, the run of show and timers, no controls", async () => {
    const el = await render(<JoinedDesk layout="page" />, "obs-companion")
    const main = el.querySelector('[aria-label="OBS companion desk"]')!
    expect(main.querySelector('[aria-label="On the screens"]')).not.toBeNull()
    expect(main.querySelector('[aria-label="Run of show (read only)"]')).not.toBeNull()
    expect(el.querySelector('[aria-label="OBS desk"]')).toBeNull()
    expect(el.querySelector('[aria-label="Scenes desk"]')).toBeNull()
  })

  it("never gives a Bible desk the Scenes, Outputs or OBS blocks", async () => {
    const el = await render(<JoinedDesk layout="page" />, "bible")
    for (const label of ["Scenes desk", "Output map", "OBS desk", "Camera desk", "Director's board", "Event clock desk"]) {
      expect(el.querySelector(`[aria-label="${label}"]`)).toBeNull()
    }
  })

  it("gives a View only desk Now/Next and the clock, without production blocks", async () => {
    const el = await render(<JoinedDesk layout="page" />, "viewer")
    const main = el.querySelector('[aria-label="Viewer desk"]')!
    expect(main.querySelector('[aria-label="Now and next"]')).not.toBeNull()
    expect(el.querySelector('[aria-label="On the screens"]')).toBeNull()
    expect(el.querySelector('[aria-label="Scenes desk"]')).toBeNull()
  })

  it("keeps the rest of Rhema Studio behind the desk's menu", async () => {
    useShellStore.setState({ joinedDeskView: "desk", searchOpen: false })
    const go = vi.fn()
    const el = await render(<JoinedDeskRoute church={[]} onGo={go} />, "bible")
    expect(el.querySelector('[data-desk-page="bible"]')).not.toBeNull()
    const trigger = el.querySelector<HTMLButtonElement>('[aria-label="Rhema Studio menu"]')!
    await act(async () => {
      trigger.focus()
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    })
    const items = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    expect(items.map((item) => item.textContent?.trim())).toEqual(expect.arrayContaining(["This computer's Live console", "Home", "Prepare", "Settings"]))
    expect(items.some((item) => item.textContent?.trim() === "Live")).toBe(false)
    await act(async () => items.find((item) => item.textContent?.trim() === "This computer's Live console")!.click())
    expect(useShellStore.getState().joinedDeskView).toBe("console")
    expect(go).not.toHaveBeenCalled()
  })

  it("the Operators card still holds the desk, with a way to open it as the page", async () => {
    useShellStore.setState({ joinedDeskView: "console", goRequest: null })
    useProductionTab.setState({ open: true })
    const el = await render(<OperatorsPanel />, "bible")
    expect(el.querySelector('[aria-label="Bible desk"]')).not.toBeNull()
    await act(async () => [...el.querySelectorAll("button")].find((b) => b.textContent === "Open your desk")!.click())
    expect(useShellStore.getState().joinedDeskView).toBe("desk")
    expect(useShellStore.getState().goRequest).toBe("present")
    expect(useProductionTab.getState().open).toBe(false)
  })
})
