// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ComponentProps } from "react"
import type { DragDropProvider } from "@dnd-kit/react"
import type { ItemInput, ProgramWithItems, QueueItem } from "@/types"

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  ;(globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent ??= MouseEvent as unknown as typeof PointerEvent
  ;(globalThis as { CSS?: { escape: (s: string) => string } }).CSS ??= { escape: (s: string) => s }
})
const drag = vi.hoisted(() => ({ droppables: new Map<string, ReturnType<typeof import("@dnd-kit/react").useDroppable>["droppable"]>(), current: null as ComponentProps<typeof DragDropProvider> | null, sortables: new Map<string, ReturnType<typeof import("@dnd-kit/react/sortable").useSortable>["sortable"]>() }))
// Keep the actual provider/hooks; expose its callbacks for deterministic collision fixtures.
vi.mock("@dnd-kit/react", async (importOriginal) => {
  const original = await importOriginal<typeof import("@dnd-kit/react")>()
  const { createElement } = await import("react")
  return { ...original, useDroppable: (input: Parameters<typeof original.useDroppable>[0]) => {
    const result = original.useDroppable(input)
    drag.droppables.set(String(input.id), result.droppable)
    return result
  }, DragDropProvider: (props: ComponentProps<typeof DragDropProvider>) => {
    drag.current = props
    return createElement(original.DragDropProvider, props)
  } }
})
vi.mock("@dnd-kit/react/sortable", async (importOriginal) => {
  const original = await importOriginal<typeof import("@dnd-kit/react/sortable")>()
  return { ...original, useSortable: (input: Parameters<typeof original.useSortable>[0]) => {
    const result = original.useSortable(input)
    drag.sortables.set(String(input.id), result.sortable)
    return result
  } }
})
const database = vi.hoisted(() => ({ saved: null as ProgramWithItems | null }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
  if (cmd.endsWith("_list")) return []
  if (cmd === "content_get_program") return structuredClone(database.saved)
  if (cmd === "content_replace_items") {
    const inputs = args!.items as ItemInput[]
    database.saved = {
      program: { id: "service", title: "Sunday", service_date: null, revision: 2, created_at: "", updated_at: "", item_count: inputs.length },
      items: inputs.map((item, position) => ({
        ...item,
        id: item.id!, program_id: "service", position,
        book_number: item.book_number ?? null, chapter: item.chapter ?? null, verse: item.verse ?? null,
        translation: item.translation ?? null, secondary_translation: item.secondary_translation ?? null,
        notes: item.notes ?? null, payload: item.payload ?? null,
      })),
    }
    return structuredClone(database.saved)
  }
  return null
}) }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emitTo: vi.fn(async () => {}), emit: vi.fn(async () => {}) }))

import { act } from "react"
import { sortCollisions, type Collision, type CollisionDetector } from "@dnd-kit/abstract"
import { Rectangle } from "@dnd-kit/geometry"
import { createRoot, type Root } from "react-dom/client"
import { RundownList } from "@/studio/present/rundown-list"
import { useQueueStore } from "@/stores/queue-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { toItemInputs, useServiceStore } from "@/stores/service-store"
import { interleave, projectRunOfShowEvents } from "@/lib/run-of-show"

const q = () => useQueueStore.getState()
const ids = () => q().items.map((item) => item.id)
const order = () => interleave(q().items, q().headers).map((r) => "header" in r ? r.header.id : r.item.id)
const live = () => structuredClone(Object.fromEntries(Object.entries(useBroadcastStore.getState()).filter(([, value]) => typeof value !== "function")))
const slide = (id: string): QueueItem => ({ id, kind: "slide", slide: { title: id, body: "keep content" }, reference: id, confidence: 1, source: "manual", added_at: 0 })
let root: Root | null = null
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useServiceStore.setState({ current: null, dirty: false, saving: false })
  useQueueStore.setState({
    items: [slide("Prayer"), slide("Scripture"), slide("Sermon"), slide("Response")],
    headers: [
      { id: "pre", type: "phase", name: "Pre-service", at: 0, rule: "manual" },
      { id: "prayer", type: "group", name: "Opening prayer", at: 0, notes: "Keep notes", event: { schema_version: 1, duration_minutes: 15, payload_extra: { future: "keep" } } },
      { id: "nested", type: "group", name: "Scripture moments", at: 1, payload_extra: { future: "keep group" } },
      { id: "main", type: "phase", name: "Main service", at: 2, rule: "manual" },
      { id: "sermon", type: "group", name: "Sermon event", at: 2, event: { schema_version: 1, duration_minutes: 40 } },
      { id: "post", type: "phase", name: "Post-service", at: 4, rule: "loop" },
    ], activeIndex: 1, removedActive: null, addTarget: null,
  })
  q().resetHistory()
  useBroadcastStore.setState({ isLive: true, liveItemId: "actual-live-item", stageMessage: "Keep stage message", sceneReturn: { main: "keep-scene" } })
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
  useServiceStore.setState({ current: null, dirty: false, saving: false })
  database.saved = null
  drag.current = null
  drag.sortables.clear()
  drag.droppables.clear()
})
async function render() {
  const el = document.createElement("div")
  document.body.appendChild(el)
  root = createRoot(el)
  await act(async () => root!.render(<RundownList mode="prepare" />))
  return el
}
function keyDown(el: HTMLElement, key: string) {
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))
}
type DragEnd = Parameters<NonNullable<ComponentProps<typeof DragDropProvider>["onDragEnd"]>>[0]
async function drop(source: unknown, target: unknown, y: number, canceled = false) {
  await act(async () => drag.current!.onDragEnd!({ canceled, operation: { source, target, position: { current: { x: 0, y } } } } as unknown as DragEnd, {} as never))
}

describe("Prepare movement keeps the plan separate from Live", () => {
  function selectCollision(headerId: string, itemId: string, pointerY: number) {
    const header = drag.droppables.get(headerId)!
    const moment = drag.sortables.get(itemId)!.droppable
    // Use the mounted targets' actual detectors and priorities, real rectangle
    // intersections and the library's sorter (including priority overrides).
    const operation = {
      position: { current: { x: 50, y: pointerY }, direction: null },
      shape: { current: new Rectangle(0, 20, 100, 44) },
    }
    const collisions = [
      { target: header, shape: new Rectangle(0, 0, 100, 40) },
      { target: moment, shape: new Rectangle(0, 40, 100, 44) },
    ].flatMap(({ target, shape }): Collision[] => {
      const collision = target.collisionDetector!({
        droppable: { id: target.id, shape }, dragOperation: operation,
      } as unknown as Parameters<CollisionDetector>[0])
      if (!collision) return []
      return [{ ...collision, priority: target.collisionPriority ?? collision.priority }]
    }).sort(sortCollisions)
    return { collisions, header, moment }
  }

  it.each([
    ["section:pre", "Prayer"],
    ["section:prayer", "Prayer"],
    ["section:nested", "Scripture"],
  ])("collision selection keeps the first moment under the pointer ahead of overlapping %s", async (headerId, itemId) => {
    await render()
    const liveBefore = live()
    const { collisions, moment } = selectCollision(headerId, itemId, 42)
    expect(collisions[0]?.id).toBe(itemId)
    const source = drag.sortables.get("Response")!.draggable
    await drop(source, { id: moment.id, data: moment.data, shape: new Rectangle(0, 40, 100, 44) }, 42)
    expect(ids()).toEqual(itemId === "Prayer"
      ? ["Response", "Prayer", "Scripture", "Sermon"]
      : ["Prayer", "Response", "Scripture", "Sermon"])
    expect(projectRunOfShowEvents(q().items, q().headers).find((event) => event.id === "sermon")!.moments.map((item) => item.id)).toEqual(["Sermon"])
    expect(live()).toEqual(liveBefore)
  })

  it.each([
    ["section:pre", "Prayer"],
    ["section:prayer", "Prayer"],
    ["section:nested", "Scripture"],
  ])("collision selection retains deliberate pointer drops onto %s", async (headerId, itemId) => {
    await render()
    expect(selectCollision(headerId, itemId, 20).collisions[0]?.id).toBe(headerId)
  })

  it("moves an event with Enter and ArrowDown, undoes/redoes it, saves and reopens every moment and nested group", async () => {
    useServiceStore.setState({ current: { id: "service", title: "Sunday", service_date: null, revision: 1, created_at: "", updated_at: "", item_count: 10 }, dirty: false })
    const before = order()
    const liveBefore = live()
    const el = await render()
    const options = el.querySelector<HTMLButtonElement>('[aria-label="Opening prayer: options"]')!
    options.focus()
    await act(async () => keyDown(options, "Enter"))
    let active = document.activeElement as HTMLElement
    expect(active.getAttribute("role")).toBe("menuitem")
    for (let step = 0; step < 8 && active.textContent?.trim() !== "Move event down"; step += 1) {
      await act(async () => keyDown(active, "ArrowDown"))
      active = document.activeElement as HTMLElement
    }
    expect(active.textContent?.trim()).toBe("Move event down")
    await act(async () => keyDown(active, "Enter"))
    expect(ids()).toEqual(["Sermon", "Response", "Prayer", "Scripture"])
    expect(q().items[q().activeIndex!].id).toBe("Scripture")
    expect(q().past).toHaveLength(1)
    expect(live()).toEqual(liveBefore)
    await act(async () => q().undo())
    expect(order()).toEqual(before)
    expect(live()).toEqual(liveBefore)
    await act(async () => q().redo())
    const moved = order()
    expect(useServiceStore.getState().dirty).toBe(true)
    await act(async () => { expect(await useServiceStore.getState().saveCurrent()).toBe("saved") })
    const savedRows = toItemInputs(q().items, undefined, undefined, q().headers)
    expect(live()).toEqual(liveBefore)
    await act(async () => {
      expect(useServiceStore.getState().closeProgram()).toBe("closed")
      useQueueStore.setState({ items: [], headers: [] })
      expect(await useServiceStore.getState().openProgram("service")).toBe("ok")
    })
    expect(order()).toEqual(moved)
    expect(toItemInputs(q().items, undefined, undefined, q().headers)).toEqual(savedRows)
    expect(projectRunOfShowEvents(q().items, q().headers).map((e) => [e.id, e.moments.map((m) => m.id)])).toEqual([
      ["sermon", ["Sermon", "Response"]], ["prayer", ["Prayer", "Scripture"]],
    ])
    expect(q().items.every((item) => item.kind === "slide" && item.slide.body === "keep content")).toBe(true)
    expect(q().past).toHaveLength(0)
    expect(q().future).toHaveLength(0)
    expect(live()).toEqual(liveBefore)
  })

  it("uses item IDs and pointer placement despite stale sort indexes; ignores canceled or missing targets", async () => {
    await render()
    const liveBefore = live()
    const sortable = drag.sortables.get("Prayer")!
    const source = sortable.draggable
    Object.defineProperties(source, {
      index: { value: 99, configurable: true },
      initialIndex: { value: 80, configurable: true },
    })
    const target = { id: "Sermon", data: {}, shape: { boundingRectangle: { top: 100, bottom: 180 } } }
    await drop(source, target, 160, true)
    await drop(source, null, 160)
    expect(q().past).toHaveLength(0)
    await drop(source, target, 160)
    expect(ids()).toEqual(["Scripture", "Sermon", "Prayer", "Response"])
    expect(q().past).toHaveLength(1)
    expect(q().items[q().activeIndex!].id).toBe("Scripture")
    expect(live()).toEqual(liveBefore)
  })

  it("drops event blocks into phases and before/after events without moving unrelated moments", async () => {
    await render()
    const liveBefore = live()
    const source = { id: "event:prayer", data: { kind: "event", headerId: "prayer" } }
    const eventTarget = { id: "section:sermon", data: { kind: "section", headerId: "sermon", headerType: "group", isEvent: true }, shape: { boundingRectangle: { top: 100, bottom: 180 } } }
    await drop(source, eventTarget, 160)
    expect(ids()).toEqual(["Sermon", "Response", "Prayer", "Scripture"])
    expect(live()).toEqual(liveBefore)
    await act(async () => q().undo())
    await drop(source, { id: "section:post", data: { kind: "section", headerId: "post", headerType: "phase" } }, 0)
    expect(order()).toEqual(["pre", "main", "sermon", "Sermon", "Response", "post", "prayer", "Prayer", "nested", "Scripture"])
    expect(q().past).toHaveLength(1)
    expect(live()).toEqual(liveBefore)
  })
})
