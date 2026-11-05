// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { useRundownSelection } from "@/studio/prepare/rundown-selection"
import { useBibleStore } from "@/stores/bible-store"
import { useQueueStore } from "@/stores/queue-store"
import type { VerseQueueItem } from "@/types"
import { useSelectedItem } from "./use-selected-item"

function SelectedItem() {
  const selected = useSelectedItem()
  return <output>{selected?.item.id ?? "none"}</output>
}

let root: Root | null = null

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const verse = {
    id: 1,
    translation_id: 1,
    book_number: 43,
    book_name: "John",
    book_abbreviation: "Jn",
    chapter: 3,
    verse: 16,
    text: "For God so loved the world",
  }
  const item = (id: string): VerseQueueItem => ({
    id,
    kind: "verse",
    verse,
    reference: "John 3:16",
    confidence: 1,
    source: "manual",
    added_at: 0,
  })
  useQueueStore.setState({ items: [item("opening"), item("sermon")], headers: [], activeIndex: null })
  useBibleStore.setState({ selectedVerse: verse, selectedSlide: null, selectedQueueItemId: "sermon" })
  useRundownSelection.setState({ focusId: "sermon", focusSlideIndex: 0 })
  const element = document.createElement("div")
  document.body.appendChild(element)
  root = createRoot(element)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

describe("Prepare selected rundown item", () => {
  it("uses the stable queue ID to distinguish repeated Scripture references", async () => {
    await act(async () => root!.render(<SelectedItem />))
    expect(document.querySelector("output")?.textContent).toBe("sermon")
  })

  it("does not silently move selection to another repeated reference after removal", async () => {
    useQueueStore.setState({ items: useQueueStore.getState().items.slice(0, 1) })
    await act(async () => root!.render(<SelectedItem />))
    expect(document.querySelector("output")?.textContent).toBe("none")
  })

  it("is Prepare's own focus, never Live's Preview (#447)", async () => {
    useRundownSelection.setState({ focusId: null })
    await act(async () => root!.render(<SelectedItem />))
    // Live's Preview holds "sermon", but Prepare has focused nothing.
    expect(document.querySelector("output")?.textContent).toBe("none")
  })
})
