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

async function render(node: React.ReactNode, role: string) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useJoin.setState({ status: "connected", me: { name: "Op", role }, live, receivedAt: performance.now(), clockSkewMs: 0, error: null, paused: false, note: null })
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
    expect(el.querySelector('[aria-label="Rhema Studio menu"]')).not.toBeNull()
    expect(el.querySelector('[data-desk-page="bible"]')).not.toBeNull()
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
