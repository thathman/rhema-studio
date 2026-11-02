import { NOTICE_TARGETS, type NoticeTarget, type NoticeTo } from "@/stores/notices-store"

export interface ReminderPolicy {
  thresholdsMin: number[]
  /** Comms destinations: `role:<role>` or a paired desk name. */
  to: string[]
  urgent: boolean
}

export interface AutomaticReminderNotice {
  to: NoticeTarget
  priority: "normal" | "urgent"
  text: string
  event: { id: string; title: string }
}

export const REMINDER_ROLE_TARGETS = NOTICE_TARGETS.filter((target): target is Exclude<NoticeTo, "all" | "host"> => target !== "all" && target !== "host")

/** Parse the small, owner-editable threshold field. An empty field deliberately disables reminders. */
export function parseReminderThresholds(text: string): number[] | null {
  if (!text.trim()) return []
  const tokens = text.split(/[\s,;]+/).filter(Boolean)
  if (tokens.length > 6) return null
  const values = tokens.map((token) => /^\d+$/.test(token) ? Number(token) : NaN)
  if (values.some((value) => !Number.isInteger(value) || value < 1 || value > 180)) return null
  return [...new Set(values)].sort((a, b) => b - a)
}

function toCommsTarget(raw: unknown): NoticeTarget | null {
  if (typeof raw !== "string") return null
  const value = raw.trim().slice(0, 84)
  if (!value) return null
  if (value.startsWith("role:")) {
    const role = value.slice(5) === "configure" ? "present" : value.slice(5)
    return NOTICE_TARGETS.find((target) => target === role && role !== "host") ?? null
  }
  if (NOTICE_TARGETS.some((target) => target === value)) return value as NoticeTo
  const name = value.startsWith("name:") ? value.slice(5).trim().slice(0, 60) : value.slice(0, 60)
  return name ? { name } : null
}

/** Turn one validated host reminder into private Comms notices, never public screen content. */
export function automaticReminderNotices(raw: unknown): AutomaticReminderNotice[] {
  if (!raw || typeof raw !== "object") return []
  const value = raw as Record<string, unknown>
  const eventId = typeof value.eventId === "string" ? value.eventId.trim().slice(0, 128) : ""
  const reference = typeof value.reference === "string" ? value.reference.replace(/\s+/g, " ").trim().slice(0, 80) : ""
  const minutes = value.minutesLeft
  if (!eventId || !reference || typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1 || minutes > 180 || !Array.isArray(value.to)) return []
  const targets = [...new Map(value.to.map(toCommsTarget).filter((target): target is NoticeTarget => target !== null).map((target) => [typeof target === "object" ? `name:${target.name.toLowerCase()}` : target, target])).values()]
  const plural = minutes === 1 ? "minute" : "minutes"
  const text = `${reference}: ${minutes} ${plural} left`
  return targets.map((to) => ({
    to,
    priority: value.urgent === true ? "urgent" : "normal",
    text,
    event: { id: eventId, title: reference },
  }))
}
