import { CUE_ACTIONS } from "@/lib/cues"
import { cuesFor } from "@/lib/item-cues"
import { isRunning } from "@/lib/timer"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useEventClock } from "@/stores/event-clock-store"
import { useHold } from "@/stores/hold-store"
import { useObsStore } from "@/stores/obs-store"
import { useQueueStore } from "@/stores/queue-store"
import { useTimerStore } from "@/stores/timer-store"
import type { CueTrigger, ItemCue, QueueItem } from "@/types"

/**
 * An item's cues (issue #193, #196 R6), run on the event clock (ADR 0001, C03): its go-live
 * message and cue and its "when it starts" cues once as its event starts (by default when the item
 * goes on air for the congregation, as before; with the clock run on its own, when the timekeeper
 * starts it; a cue-only item, when it is taken); "when its planned time is up" once its planned
 * minutes have passed; "when it is paused" at a hold or when the service timer is paused; "when it
 * ends" as the next event starts or the service finishes. Never in rehearsal, never again for a
 * Restore, a slide of the same song or a return from a quick screen. None changes the screens.
 */
export function runItemCues(item: QueueItem, on: CueTrigger): void | Promise<void> {
  if (useBroadcastStore.getState().rehearsal) return
  const list = cuesFor(item, on)
  const warn = (c: ItemCue, e: unknown) => console.warn(`[cues] ${item.reference}: ${c.do} failed:`, e)
  // In the same update as far as it can (a stage message is up at once); after a step that has to
  // wait (OBS), the rest follow it in order.
  const from = (k: number): void | Promise<void> => {
    for (let j = k; j < list.length; j++) {
      const c = list[j]
      let r: unknown
      try {
        r = c.do === "stage.message" ? useBroadcastStore.getState().setStageMessage(c.text ?? "") : c.do === "obs.mark" ? useObsStore.getState().mark(c.text || item.reference) : CUE_ACTIONS[c.do].run()
      } catch (e) {
        warn(c, e)
      }
      if (r instanceof Promise) return r.catch((e: unknown) => warn(c, e)).then(() => from(j + 1))
    }
  }
  return from(0)
}

const itemById = (id: string | null): QueueItem | undefined => (id ? useQueueStore.getState().items.find((i) => i.id === id) : undefined)

// "When its planned time is up": the current event's due time, kept so a late timer (the window
// hidden) is caught up on the app's tick, and a hold makes it wait for Resume.
let finish: { id: string; at: number } | null = null
let finishTimer: ReturnType<typeof setTimeout> | null = null

function clearFinish() {
  if (finishTimer) clearTimeout(finishTimer)
  finishTimer = null
  finish = null
}

function armFinish(item: QueueItem, now = Date.now()) {
  clearFinish()
  const minutes = item.planned_minutes ?? 0
  if (minutes <= 0 || item.timing?.milestone || cuesFor(item, "finish").length === 0) return
  finish = { id: item.id, at: now + minutes * 60_000 }
  finishTimer = setTimeout(() => catchUpItemCues(), minutes * 60_000)
}

/** On the app's tick (and its own timer): fire a due "planned time is up" cue, unless on hold. */
export function catchUpItemCues(now = Date.now()): void {
  if (!finish || now < finish.at || useHold.getState().hold) return
  const due = finish
  clearFinish()
  const item = itemById(due.id)
  if (item && useEventClock.getState().currentId === due.id) queue(() => runItemCues(item, "finish"))
}

// The steps of one moment and the next run in order (an "end" marker before the next item's "start").
// With nothing waiting, a moment's cues run at once (in the same update); while one waits (OBS), the next follow it.
let tail: Promise<void> | null = null
function queue(fn: () => void | Promise<void>) {
  const r = tail ? tail.then(fn, fn) : fn()
  if (!(r instanceof Promise)) return
  const t: Promise<void> = r.then(() => {}, () => {})
  tail = t
  void t.then(() => { if (tail === t) tail = null })
}

useEventClock.subscribe((s, prev) => {
  if (s.currentId === prev.currentId) return
  const before = itemById(prev.currentId)
  clearFinish()
  if (before) queue(() => runItemCues(before, "end"))
  const now = itemById(s.currentId)
  if (!now || useBroadcastStore.getState().rehearsal) return
  queue(() => runItemCues(now, "live"))
  armFinish(now)
})

// "When it is paused": a hold starting, or the service timer paused (not reset) during the item.
// Just after the hold's own stage message, so the item's own one is what the stage shows.
function paused() {
  const item = itemById(useEventClock.getState().currentId)
  if (item) queueMicrotask(() => queue(() => runItemCues(item, "pause")))
}
useHold.subscribe((s, prev) => {
  if (!prev.hold && s.hold) paused()
  if (prev.hold && !s.hold) catchUpItemCues()
})
useTimerStore.subscribe((s, prev) => {
  if (isRunning(prev.timer) && !isRunning(s.timer) && s.timer.accumulatedMs !== 0) paused()
})
