// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, describe, expect, it } from "vitest"
import type { QueueItem } from "@/types"
import { useQueueStore } from "@/stores/queue-store"
import { useSettingsStore } from "@/stores/settings-store"
import { CommentsEditor } from "./item-editor-parts"

const comment = { id: "comment-1", by: "Ade", at: "2026-10-21T10:00:00Z", text: "Read slowly" }
const item = { id: "i1", reference: "John 3:16", comments: [comment] } as unknown as QueueItem

async function render(name: string) {
  useSettingsStore.setState({ operatorName: name })
  useQueueStore.setState({ items: [item] })
  const el = document.createElement("div")
  const root = createRoot(el)
  await act(async () => root.render(<CommentsEditor item={item} />))
  return { el, root }
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  document.body.replaceChildren()
})

describe("Prepare comment removal (#393)", () => {
  it("does not offer removal of another operator's comment", async () => {
    const { el, root } = await render("Tolu")
    expect(el.querySelector('button[aria-label="Remove Ade\'s comment"]')).toBeNull()
    act(() => root.unmount())
  })

  it("keeps an author's removal as an attributed tombstone", async () => {
    const { el, root } = await render("Ade")
    const remove = el.querySelector<HTMLButtonElement>('button[aria-label="Remove Ade\'s comment"]')
    expect(remove).not.toBeNull()
    await act(async () => remove!.click())
    const saved = useQueueStore.getState().items[0].comments?.[0]
    expect(saved).toMatchObject({ by: "Ade", text: "Read slowly", deleted_by: "Ade" })
    expect(Date.parse(saved?.deleted_at ?? "NaN")).not.toBeNaN()
    expect(el.textContent).toContain("Removed by Ade")
    expect(el.querySelector('button[aria-label="Remove Ade\'s comment"]')).toBeNull()
    act(() => root.unmount())
  })
})
