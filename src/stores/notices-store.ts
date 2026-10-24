import { create } from "zustand"

/**
 * Production notices (Rhema Comms C1, #251): short private messages between the host desk and the
 * operators who joined it, each answered Seen, Ready or Unable. They live on the host (the last
 * 100, kept through a crash like the service log), travel in its Live State so a reconnecting desk
 * catches up (each desk gets only the ones for it), and never reach a screen, the stage, a feed or
 * the service log.
 */
export type NoticeTo = "all" | "host" | "timekeeper" | "bible" | "screens" | "present"
/** A group, or one paired desk or person by name. */
export type NoticeTarget = NoticeTo | { name: string }
export type NoticeAnswer = "seen" | "ready" | "unable"
/**
 * An action request (Comms C2): what the recipient is asked to do. It is only offered on their desk
 * as one button; nothing runs until they press it. bible: a reference; scene: a scene id; event: a
 * run-of-show item id.
 */
export interface NoticeAction { kind: "bible" | "scene" | "event"; value: string }

export interface Notice {
  id: string
  from: string
  to: NoticeTarget
  priority: "normal" | "urgent"
  text: string
  /** The run-of-show event it is about. */
  event?: { id: string; title: string } | null
  action?: NoticeAction | null
  at: number
  answers: { by: string; state: NoticeAnswer; at: number }[]
}

export const NOTICE_TARGETS: readonly NoticeTo[] = ["all", "host", "timekeeper", "bible", "screens", "present"]
const ANSWERS: readonly NoticeAnswer[] = ["seen", "ready", "unable"]
const MAX = 100

interface NoticesState {
  notices: Notice[]
  /** Notices this desk has read (ids), for the unread count. */
  read: string[]
  send: (n: { from: string; to?: unknown; priority?: string; text: string; event?: { id: string; title: string } | null; action?: unknown }) => Notice | null
  answer: (id: string, by: string, state: string) => void
  markRead: (ids: string[]) => void
  /** Notices kept from the run that closed unexpectedly (src/lib/live-recovery.ts), behind any sent since. */
  restore: (kept: Notice[], read: string[]) => void
}

export const useNotices = create<NoticesState>((set, get) => ({
  notices: [],
  read: [],
  send: ({ from, to, priority, text, event, action }) => {
    const body = text.trim().slice(0, 280)
    if (!body) return null
    const notice: Notice = {
      id: crypto.randomUUID(),
      from: from.trim().slice(0, 60) || "Someone",
      to: asTarget(to),
      priority: priority === "urgent" ? "urgent" : "normal",
      text: body,
      event: event ?? null,
      action: asAction(action),
      at: Date.now(),
      answers: [],
    }
    set({ notices: [notice, ...get().notices].slice(0, MAX) })
    return notice
  },
  answer: (id, by, state) => {
    const s = ANSWERS.find((a) => a === state)
    if (!s) return
    const who = by.trim().slice(0, 60) || "Someone"
    set({ notices: get().notices.map((n) => (n.id === id ? { ...n, answers: [...n.answers.filter((a) => a.by !== who), { by: who, state: s, at: Date.now() }] } : n)) })
  },
  markRead: (ids) => set({ read: [...new Set([...get().read, ...ids])].slice(-500) }),
  restore: (kept, read) => {
    const have = new Set(get().notices.map((n) => n.id))
    const back = kept.filter((n) => n && typeof n.id === "string" && !have.has(n.id) && typeof n.text === "string" && Array.isArray(n.answers)).map((n) => ({ ...n, to: asTarget(n.to) }))
    set({ notices: [...get().notices, ...back].slice(0, MAX), read: [...new Set([...get().read, ...read])].slice(-500) })
  },
}))

/** A known group or one named desk; anything else is everyone. */
export function asTarget(to: unknown): NoticeTarget {
  if (to && typeof to === "object" && typeof (to as { name?: unknown }).name === "string") {
    const name = (to as { name: string }).name.trim().slice(0, 60)
    if (name) return { name }
  }
  return NOTICE_TARGETS.find((t) => t === to) ?? "all"
}

/** Who a notice is addressed to, in words. */
export function targetName(to: NoticeTarget): string {
  return typeof to === "object" ? to.name : TARGET_NAMES[to]
}
export const TARGET_NAMES: Record<NoticeTo, string> = { all: "Everyone", host: "The main desk", timekeeper: "Timekeeper", bible: "Bible", screens: "Screens", present: "Present desks" }

/**
 * Whether a notice is for a desk with this role ("host" for the main desk) and, for one sent to a
 * person, this name. The host's server applies the same rule before a desk receives it.
 */
export function isFor(n: Notice, role: string, name?: string): boolean {
  if (typeof n.to === "object") return !!name && n.to.name.trim().toLowerCase() === name.trim().toLowerCase()
  return n.to === "all" || n.to === role || (role === "configure" && n.to === "present")
}

/** A well-formed action request, or null (it may come from another computer). */
export function asAction(a: unknown): NoticeAction | null {
  if (!a || typeof a !== "object") return null
  const { kind, value } = a as Record<string, unknown>
  if ((kind !== "bible" && kind !== "scene" && kind !== "event") || typeof value !== "string" || !value.trim()) return null
  return { kind, value: value.trim().slice(0, 120) }
}

/**
 * The congregation outputs a "take this scene" request switches: those already showing a scene (the
 * program), else the main output, else the first.
 */
export function sceneTargets(outputs: { id: string; sceneId?: string | null }[]): string[] {
  const showing = outputs.filter((o) => o.sceneId).map((o) => o.id)
  if (showing.length) return showing
  const main = outputs.find((o) => o.id === "main") ?? outputs[0]
  return main ? [main.id] : []
}
