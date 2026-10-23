import { create } from "zustand"

/**
 * Production notices (Rhema Comms C1, #251): short private messages between the host desk and the
 * operators who joined it, each answered Seen, Ready or Unable. They live only on the host for this
 * session (the last 100), travel in its Live State so a reconnecting desk catches up, and never
 * reach a screen, the stage, a feed or the service log.
 */
export type NoticeTo = "all" | "host" | "timekeeper" | "bible" | "screens" | "present"
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
  to: NoticeTo
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
  send: (n: { from: string; to?: string; priority?: string; text: string; event?: { id: string; title: string } | null; action?: unknown }) => Notice | null
  answer: (id: string, by: string, state: string) => void
  markRead: (ids: string[]) => void
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
      to: NOTICE_TARGETS.find((t) => t === to) ?? "all",
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
}))

/** Whether a notice is for a desk with this role ("host" for the main desk). */
export function isFor(n: Notice, role: string): boolean {
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
