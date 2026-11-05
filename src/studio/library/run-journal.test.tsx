// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { RunJournal } from "./run-journal"
import { useBroadcastStore } from "@/stores/broadcast-store"
import type { JournalEntry } from "@/lib/journal"

/** #447: History shows a saved run's whole log, outputs by name, and a filter by person or output. */
let element: HTMLDivElement
let root: Root
const initialOutputs = useBroadcastStore.getState().outputs

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  element = document.createElement("div")
  document.body.appendChild(element)
  root = createRoot(element)
  useBroadcastStore.setState({ outputs: [...initialOutputs, { ...initialOutputs[0]!, id: "overflow", name: "Overflow hall" }] })
})

afterEach(() => {
  act(() => root.unmount())
  element.remove()
  useBroadcastStore.setState({ outputs: initialOutputs })
})

const entry = (i: number, over: Partial<JournalEntry> = {}): JournalEntry => ({ at: 1_800_000_000_000 + i * 1000, mono: i * 1000, kind: "live", label: `Item ${i}`, itemId: `i${i}`, ...over })

function filter(text: string) {
  const input = element.querySelector<HTMLInputElement>('[aria-label="Filter this run\'s log"]')!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

const rows = () => [...element.querySelectorAll('[aria-label="This run\'s log"] li')].map((li) => li.textContent ?? "")

describe("a saved run's log in History (#447)", () => {
  it("keeps the whole run, the opening included, not the last hundred", () => {
    const entries = [entry(0, { label: "Opening prayer" }), ...Array.from({ length: 299 }, (_, i) => entry(i + 1))]
    act(() => root.render(<RunJournal entries={entries} />))
    expect(rows()).toHaveLength(300)
    expect(rows()[0]).toContain("Opening prayer")
    expect(element.textContent).toContain("300 entries")
  })

  it("names the output an entry affected, and says when it was removed since", () => {
    act(() => root.render(<RunJournal entries={[entry(1, { kind: "scene", label: "Sermon scene", outputId: "overflow" }), entry(2, { kind: "scene", label: "Old scene", outputId: "gone" })]} />))
    expect(rows()[0]).toContain("Overflow hall")
    expect(rows()[0]).not.toContain("overflow ·")
    expect(rows()[1]).toContain("removed output (gone)")
  })

  it("filters by a person, an output or a kind, and keeps each entry's place in the run", () => {
    const entries = [entry(1, { by: "Femi", label: "Psalm 23" }), entry(2, { kind: "scene", label: "Sermon scene", outputId: "overflow" }), entry(3, { kind: "take", label: "Take failed: Psalm 91 v3 · by Tolu", by: "Tolu" })]
    act(() => root.render(<RunJournal entries={entries} />))
    filter("femi")
    expect(rows()).toEqual([expect.stringContaining("Psalm 23")])
    expect(element.textContent).toContain("1 of 3")
    filter("overflow")
    expect(rows()).toEqual([expect.stringContaining("Sermon scene")])
    expect(element.querySelector('[aria-label="This run\'s log"] li')!.getAttribute("value")).toBe("2")
    filter("take")
    expect(rows()).toEqual([expect.stringContaining("v3")])
    filter("zzz")
    expect(element.textContent).toContain("Nothing in this run's log matches")
  })

  it("says so when nothing was captured", () => {
    act(() => root.render(<RunJournal entries={[]} />))
    expect(element.textContent).toContain("No journal entries were captured")
  })
})
