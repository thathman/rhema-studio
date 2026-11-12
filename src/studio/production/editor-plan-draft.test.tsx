// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { mockInvoke, canSend } = vi.hoisted(() => ({ mockInvoke: vi.fn(), canSend: { value: true } }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => mockInvoke(...args) }))
vi.mock("@/stores/join-store", () => ({ useCanSend: () => canSend.value }))

import { act } from "react"
import { createRoot } from "react-dom/client"
import { EditorPlanDraft } from "@/studio/production/editor-plan-draft"
import { FORBIDDEN_WORDS } from "@/lib/plans-client"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const program = (revision: number, approved: number | null = 2) => ({ id: "p1", title: "Sunday Worship", service_date: "2026-11-15", revision, item_count: 2, approved_revision: approved })
const plan = (revision: number, notes: string | null = null, approved: number | null = 2) => ({
  program: program(revision, approved),
  items: [
    { id: "i1", position: 0, kind: "cue", reference: "Welcome", book_number: null, chapter: null, verse: null, translation: null, secondary_translation: null, notes, payload: null },
    { id: "i2", position: 1, kind: "verse", reference: "John 3:16", book_number: 43, chapter: 3, verse: 16, translation: "KJV", secondary_translation: null, notes: null, payload: null },
  ],
})

let root: ReturnType<typeof createRoot> | null = null
let element: HTMLDivElement
let hostRevision = 3
const calls = (command: string) => mockInvoke.mock.calls.filter(([c]) => c === command)

const button = (name: string) => [...element.querySelectorAll("button")].find((b) => b.textContent === name) as HTMLButtonElement
const click = async (b: HTMLButtonElement) => act(async () => { b.click() })
const type = async (input: HTMLInputElement | HTMLTextAreaElement, value: string) => act(async () => {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
})
const result = () => element.querySelector("[aria-label='Plan draft result']")?.textContent ?? ""

beforeEach(async () => {
  hostRevision = 3
  canSend.value = true
  mockInvoke.mockReset()
  mockInvoke.mockImplementation(async (command: string) => {
    if (command === "join_plans") return [program(hostRevision)]
    if (command === "join_plan") return plan(hostRevision)
    if (command === "join_save_plan") return plan(hostRevision + 1, "Welcome everyone")
    if (command === "join_submit_plan") return { id: "request-1", kind: "plan_approve", baseRevision: hostRevision, state: "submitted" }
    return null
  })
  element = document.createElement("div")
  document.body.append(element)
  root = createRoot(element)
  await act(async () => root!.render(<EditorPlanDraft />))
})

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = null
  document.body.replaceChildren()
})

describe("joined Editor plan draft (#847)", () => {
  it("loads the host's plan and saves the draft at the revision it opened", async () => {
    expect(calls("join_plan")[0]![1]).toMatchObject({ id: "p1" })
    expect(element.textContent).toContain("Revision 3 · approved 2 · saved")
    expect(button("Save draft").disabled).toBe(true)
    await type(element.querySelector("[aria-label='Notes for item 1']") as HTMLTextAreaElement, "Welcome everyone")
    expect(element.textContent).toContain("unsaved changes")
    expect(button("Submit for review").disabled).toBe(true)
    await click(button("Save draft"))
    const [, args] = calls("join_save_plan")[0]!
    expect(args).toMatchObject({ id: "p1", expectedRevision: 3 })
    expect((args as { items: unknown[] }).items).toEqual([
      expect.objectContaining({ id: "i1", kind: "cue", notes: "Welcome everyone" }),
      expect.objectContaining({ id: "i2", kind: "verse", book_number: 43, chapter: 3, verse: 16 }),
    ])
    expect(result()).toContain("Draft saved as revision 4")
    expect(element.textContent).toContain("Revision 4 · approved 2 · saved")
  })

  it("on a 409 offers reload or keep mine, and keeping mine saves over the host's new revision", async () => {
    mockInvoke.mockImplementation(async (command: string, args: { expectedRevision?: number }) => {
      if (command === "join_plans") return [program(hostRevision)]
      if (command === "join_plan") return plan(hostRevision)
      if (command === "join_save_plan") {
        if (args.expectedRevision !== hostRevision) throw "conflict:5: The plan changed since you opened it"
        return plan(hostRevision + 1, "mine")
      }
      return null
    })
    await type(element.querySelector("[aria-label='Notes for item 1']") as HTMLTextAreaElement, "mine")
    hostRevision = 5
    await click(button("Save draft"))
    const conflict = element.querySelector("[aria-label='Plan conflict']")!
    expect(conflict.textContent).toContain("The plan changed on the host since you opened it")
    expect(conflict.textContent).toContain("revision 5")
    expect(button("Save draft").disabled).toBe(true)
    await click(button("Keep my draft"))
    expect(element.querySelector("[aria-label='Plan conflict']")).toBeNull()
    expect((element.querySelector("[aria-label='Notes for item 1']") as HTMLTextAreaElement).value).toBe("mine")
    const before = calls("join_save_plan").length
    await click(button("Save draft"))
    expect(calls("join_save_plan").length).toBe(before)
    expect(element.querySelector(`[aria-label="Replace the host's changes"]`)?.textContent).toContain("replaces the host's revision 5")
    await click(button("Replace with my draft"))
    expect(calls("join_save_plan").at(-1)![1]).toMatchObject({ expectedRevision: 5 })
    expect(result()).toContain("Draft saved as revision 6")
  })

  it("before saving over the host's newer plan, says how many items and which ones disappear", async () => {
    mockInvoke.mockImplementation(async (command: string, args: { expectedRevision?: number }) => {
      if (command === "join_plans") return [program(hostRevision)]
      if (command === "join_plan") {
        const p = plan(hostRevision)
        if (hostRevision === 5) p.items.push({ ...p.items[0]!, id: "i3", position: 2, reference: "Offering" })
        return p
      }
      if (command === "join_save_plan") {
        if (args.expectedRevision !== hostRevision) throw "conflict:5: moved"
        return plan(6)
      }
      return null
    })
    await click(button("Remove"))
    hostRevision = 5
    await click(button("Save draft"))
    await click(button("Keep my draft"))
    await click(button("Save draft"))
    const warning = element.querySelector(`[aria-label="Replace the host's changes"]`)!.textContent!
    expect(warning).toContain("The host's plan has 3 items; yours has 1")
    expect(warning).toContain("These items will disappear: Welcome, Offering.")
    await click(button("Cancel"))
    expect(calls("join_save_plan").filter(([, a]) => (a as { expectedRevision: number }).expectedRevision === 5)).toEqual([])
  })

  it("a conflict on Submit does not claim the draft went unsaved", async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "join_plans") return [program(3)]
      if (command === "join_plan") return plan(3)
      if (command === "join_submit_plan") throw "conflict:4: moved"
      return null
    })
    await click(button("Submit for review"))
    const banner = element.querySelector("[aria-label='Plan conflict']")!.textContent!
    expect(banner).toContain("Your revision 3 is still saved on the host, but it was not submitted for review")
    expect(banner).not.toContain("not saved")
  })

  it("locks editing while a save is in flight, so nothing typed meanwhile is dropped", async () => {
    let answer: (v: unknown) => void = () => {}
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "join_plans") return [program(3)]
      if (command === "join_plan") return plan(3)
      if (command === "join_save_plan") return new Promise((resolve) => { answer = resolve })
      return null
    })
    await type(element.querySelector("[aria-label='Notes for item 1']") as HTMLTextAreaElement, "first")
    await click(button("Save draft"))
    expect((element.querySelector("[aria-label='Draft editing']") as HTMLFieldSetElement).disabled).toBe(true)
    expect(element.textContent).toContain("editing is paused until the host answers")
    await act(async () => answer(plan(4, "first")))
    expect((element.querySelector("[aria-label='Draft editing']") as HTMLFieldSetElement).disabled).toBe(false)
    expect((element.querySelector("[aria-label='Notes for item 1']") as HTMLTextAreaElement).value).toBe("first")
  })

  it("asks before switching plans drops unsaved changes", async () => {
    mockInvoke.mockImplementation(async (command: string, args: { id?: string }) => {
      if (command === "join_plans") return [program(3), { ...program(1), id: "p2", title: "Midweek" }]
      if (command === "join_plan") return args.id === "p2" ? { ...plan(1), program: { ...program(1), id: "p2", title: "Midweek" } } : plan(3)
      return null
    })
    await act(async () => root!.unmount())
    root = createRoot(element)
    await act(async () => root!.render(<EditorPlanDraft />))
    await type(element.querySelector("[aria-label='Notes for item 1']") as HTMLTextAreaElement, "mine")
    const choose = async (id: string) => act(async () => {
      const select = element.querySelector("[aria-label='Service plan']") as HTMLSelectElement
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, id)
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })
    const opened = calls("join_plan").length
    await choose("p2")
    expect(element.querySelector("[aria-label='Unsaved draft']")?.textContent).toContain("Opening Midweek drops them")
    expect(calls("join_plan").length).toBe(opened)
    await click(button("Stay and keep my changes"))
    expect((element.querySelector("[aria-label='Notes for item 1']") as HTMLTextAreaElement).value).toBe("mine")
    await choose("p2")
    await click(button("Open it and drop my changes"))
    expect(calls("join_plan").at(-1)![1]).toMatchObject({ id: "p2" })
    expect(element.textContent).toContain("Revision 1")
  })

  it("on a 409, reloading takes the host's plan and drops the unsaved change", async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "join_plans") return [program(3)]
      if (command === "join_plan") return plan(hostRevision)
      if (command === "join_save_plan") throw "conflict:4: The plan changed since you opened it"
      return null
    })
    await type(element.querySelector("[aria-label='Notes for item 1']") as HTMLTextAreaElement, "mine")
    hostRevision = 4
    await click(button("Save draft"))
    await click(button("Reload the host's plan"))
    expect((element.querySelector("[aria-label='Notes for item 1']") as HTMLTextAreaElement).value).toBe("")
    expect(element.textContent).toContain("Revision 4 · approved 2 · saved")
  })

  it("submits the saved revision for review with the reviewer note", async () => {
    await type(element.querySelector("[aria-label='Note for the reviewer']") as HTMLInputElement, "ready for Sunday")
    await click(button("Submit for review"))
    expect(calls("join_submit_plan")[0]![1]).toMatchObject({ id: "p1", revision: 3, note: "ready for Sunday" })
    expect(result()).toContain("Revision 3 is with the main desk for review")
    expect(result()).toContain("not approved")
  })

  it("says a 403 in plain words", async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "join_plans") return [program(3)]
      if (command === "join_plan") return plan(3)
      throw "forbidden: This desk's role does not work on the service plan"
    })
    await click(button("Submit for review"))
    expect(result()).toBe(FORBIDDEN_WORDS)
    expect(element.querySelector("[role='alert']")?.textContent).toBe(FORBIDDEN_WORDS)
  })

  it("keeps Save and Submit off while the main desk has paused this desk", async () => {
    canSend.value = false
    await act(async () => root!.render(<EditorPlanDraft />))
    expect(button("Save draft").disabled).toBe(true)
    expect(button("Submit for review").disabled).toBe(true)
    expect(element.textContent).toContain("not accepting changes from this desk")
  })
})
