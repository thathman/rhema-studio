import { create } from "zustand"
import { useSettingsStore } from "@/stores/settings-store"

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
 * as a button; nothing runs until they press it. bible: a reference; song: a song or hymn's title
 * in the library; scene: a scene id; event: a run-of-show item id; camera: a camera's name, asked
 * whether it is framed (answering Ready or Unable is the action).
 */
export interface NoticeAction { kind: "bible" | "song" | "scene" | "event" | "camera"; value: string }
export const ACTION_KINDS: readonly NoticeAction["kind"][] = ["bible", "song", "scene", "event", "camera"]
/**
 * How the recipient carries out a request that puts something on screen: Show (as the button says)
 * or Preview (into the main desk's Preview only; nothing goes live).
 */
export type ActionMode = "show" | "preview"
/** Requests that can go to Preview first: a verse, a song or hymn. A scene has no Preview: it is taken or not. */
export const canPreview = (a: NoticeAction): boolean => a.kind === "bible" || a.kind === "song"

export interface Notice {
  id: string
  from: string
  /**
   * Who sent it, as the host knows it: the sending key's id (stamped by the host's server, never
   * taken from a message) or "host" for the main desk. The server decides "sent by this desk" by it,
   * not by the name. Absent on notices from before it.
   */
  fromId?: string
  to: NoticeTarget
  /** For one person: that paired device's key id, found from the name when the notice is made. */
  toId?: string
  priority: "normal" | "urgent"
  text: string
  /** The run-of-show event it is about. */
  event?: { id: string; title: string } | null
  action?: NoticeAction | null
  at: number
  /** `why`: for Unable, what could not be done and why, in the answering desk's words (absent from older builds). */
  answers: { by: string; state: NoticeAnswer; at: number; why?: string }[]
}

export const NOTICE_TARGETS: readonly NoticeTo[] = ["all", "host", "timekeeper", "bible", "screens", "present"]
const ANSWERS: readonly NoticeAnswer[] = ["seen", "ready", "unable"]
const MAX = 100

interface NoticesState {
  notices: Notice[]
  /** Notices this desk has read (ids), for the unread count. */
  read: string[]
  send: (n: { from: string; fromId?: string; to?: unknown; priority?: string; text: string; event?: { id: string; title: string } | null; action?: unknown }) => Notice | null
  /** `why`: the reason for an Unable answer, kept with it for whoever sent the notice. */
  answer: (id: string, by: string, state: string, why?: string) => void
  markRead: (ids: string[]) => void
  /** Notices kept from the run that closed unexpectedly (src/lib/live-recovery.ts), behind any sent since. */
  restore: (kept: Notice[], read: string[]) => void
}

export const useNotices = create<NoticesState>((set, get) => ({
  notices: [],
  read: [],
  send: ({ from, fromId, to, priority, text, event, action }) => {
    const body = text.trim().slice(0, 280)
    if (!body) return null
    const target = asTarget(to)
    // One person: the paired device of that name now, by its key (the host's server delivers by it).
    const toId = typeof target === "object" ? useSettingsStore.getState().remoteDevices.find((d) => d.name.trim().toLowerCase() === target.name.toLowerCase())?.hash : undefined
    const notice: Notice = {
      id: crypto.randomUUID(),
      from: from.trim().slice(0, 60) || "Someone",
      ...(fromId ? { fromId } : {}),
      to: target,
      ...(toId ? { toId } : {}),
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
  answer: (id, by, state, why) => {
    const s = ANSWERS.find((a) => a === state)
    if (!s) return
    const who = by.trim().slice(0, 60) || "Someone"
    const reason = s === "unable" && typeof why === "string" ? why.replace(/\s+/g, " ").trim().slice(0, 200) : ""
    set({ notices: get().notices.map((n) => (n.id === id ? { ...n, answers: [...n.answers.filter((a) => a.by !== who), { by: who, state: s, at: Date.now(), ...(reason ? { why: reason } : {}) }] } : n)) })
  },
  markRead: (ids) => set({ read: [...new Set([...get().read, ...ids])].slice(-500) }),
  restore: (kept, read) => {
    const have = new Set(get().notices.map((n) => n.id))
    const back = kept.filter((n) => n && typeof n.id === "string" && !have.has(n.id) && typeof n.text === "string" && Array.isArray(n.answers)).map((n) => ({ ...n, to: asTarget(n.to) }))
    set({ notices: [...get().notices, ...back].slice(0, MAX), read: [...new Set([...get().read, ...read])].slice(-500) })
  },
}))

// Why this desk could not do what a notice asked, by notice id, until its Unable answer is sent.
const unableReasons = new Map<string, string>()

/** This desk could not do what notice `id` asked: the reason goes with its Unable answer (Comms, #251). */
export function noteUnableReason(id: string, why: string): void {
  unableReasons.set(id, why)
  // Only ever a few: a request answered long ago is not worth keeping.
  if (unableReasons.size > 50) unableReasons.delete(unableReasons.keys().next().value!)
}

/** The reason noted for notice `id`, once (it goes with that one answer). */
export function takeUnableReason(id: string): string | undefined {
  const why = unableReasons.get(id)
  unableReasons.delete(id)
  return why
}

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
  const k = ACTION_KINDS.find((x) => x === kind)
  if (!k || typeof value !== "string" || !value.trim()) return null
  return { kind: k, value: value.trim().slice(0, 120) }
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
