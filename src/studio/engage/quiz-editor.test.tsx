// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { useQueueStore } from "@/stores/queue-store"
import { ENGAGE_PAYLOAD_KEY, engageFromItem, newEngageQuiz } from "@/lib/engage"
import type { CueQueueItem } from "@/types"
import { EngageAddPanel, EngageItemEditor } from "./quiz-editor"

let root: Root | null = null

function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value)
  element.dispatchEvent(new Event("input", { bubbles: true }))
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useQueueStore.setState({ items: [], headers: [], activeIndex: null })
  const element = document.createElement("div")
  document.body.appendChild(element)
  root = createRoot(element)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe("Engage quiz preparation", () => {
  it("reports the inserted quiz id to Prepare's shared select and focus path", async () => {
    const onAdded = vi.fn()
    await act(async () => root!.render(<EngageAddPanel onAdded={onAdded} />))

    const prompt = document.querySelector<HTMLTextAreaElement>('textarea[placeholder="What did we learn from today\'s sermon?"]')!
    await act(async () => setValue(prompt, "Which book was read?"))
    for (let index = 0; index < 4; index++) {
      const answer = document.querySelector<HTMLInputElement>(`input[aria-label="Question 1 answer ${index + 1}"]`)!
      await act(async () => setValue(answer, ["Romans", "Mark", "Luke", "Acts"][index]))
    }
    const approval = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    await act(async () => approval.click())
    const save = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Add quiz to service")!
    await act(async () => save.click())

    const inserted = useQueueStore.getState().items[0]
    expect(inserted.id).toBeTruthy()
    expect(engageFromItem(inserted)).toMatchObject({ title: "Sunday Sermon & Service Recall", reviewed: true })
    expect(onAdded).toHaveBeenCalledWith(inserted.id)
  })

  it("resets approval after an edit and saves the changed quiz to its service item", async () => {
    const quiz = {
      ...newEngageQuiz(),
      reviewed: true,
      questions: [{ prompt: "Which book was read?", choices: ["Romans", "Mark", "Luke", "Acts"] as [string, string, string, string], correctIndex: 0, source: "service" as const, reference: "Romans 8" }],
    }
    const item: CueQueueItem = {
      id: "engage-edit-1", kind: "cue", reference: quiz.title, confidence: 1,
      source: "manual", added_at: 0, planned_minutes: 2,
      payload_extra: { [ENGAGE_PAYLOAD_KEY]: quiz },
    }
    useQueueStore.setState({ items: [item], headers: [], activeIndex: 0 })
    await act(async () => root!.render(<EngageItemEditor item={item} />))

    const titleLabel = [...document.querySelectorAll<HTMLLabelElement>("label")]
      .find(label => label.textContent?.includes("Quiz title"))
    if (!titleLabel) throw new Error("Quiz title label was not rendered")
    const title = titleLabel.querySelector<HTMLInputElement>("input")
    if (!title) throw new Error("Quiz title input was not rendered")
    const approval = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(approval.checked).toBe(true)
    await act(async () => setValue(title, "Updated Sunday Recall"))
    expect(title.value).toBe("Updated Sunday Recall")
    expect(approval.checked).toBe(false)
    await act(async () => approval.click())
    const save = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find(button => button.textContent?.trim() === "Save quiz in service")!
    await act(async () => save.click())

    const saved = useQueueStore.getState().items[0]
    expect(saved.reference).toBe("Updated Sunday Recall")
    expect(engageFromItem(saved)).toMatchObject({ title: "Updated Sunday Recall", reviewed: true })
  })
})
