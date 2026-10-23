import { create } from "zustand"

/**
 * Production notices (Rhema Comms C1, #251): short private messages between the host desk and the
 * operators who joined it, each answered Seen, Ready or Unable. They live only on the host for this
 * session (the last 100), travel in its Live State so a reconnecting desk catches up, and never
 * reach a screen, the stage, a feed or the service log.
 */
export type NoticeTo = "all" | "host" | "timekeeper" | "bible" | "screens" | "present"
export type NoticeAnswer = "seen" | "ready" | "unable"

export interface Notice {
  id: string
  from: string
  to: NoticeTo
  priority: "normal" | "urgent"
  text: string
  /** The run-of-show event it is about. */
  event?: { id: string; title: string } | null
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
  send: (n: { from: string; to?: string; priority?: string; text: string; event?: { id: string; title: string } | null }) => Notice | null
  answer: (id: string, by: string, state: string) => void
  markRead: (ids: string[]) => void
}

export const useNotices = create<NoticesState>((set, get) => ({
  notices: [],
  read: [],
  send: ({ from, to, priority, text, event }) => {
    const body = text.trim().slice(0, 280)
    if (!body) return null
    const notice: Notice = {
      id: crypto.randomUUID(),
      from: from.trim().slice(0, 60) || "Someone",
      to: NOTICE_TARGETS.find((t) => t === to) ?? "all",
      priority: priority === "urgent" ? "urgent" : "normal",
      text: body,
      event: event ?? null,
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
