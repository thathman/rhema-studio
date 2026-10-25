import { create } from "zustand"

/**
 * Readiness reminders the operator put away with Got it (#213: the TV overscan reminder, once per
 * service). Each key names the reminder and the service ("overscan:<service id>"); kept on this
 * computer so a restart does not ask again. The newest few are kept.
 */
const KEY = "rhema.dismissedChecks"
const MAX = 50

function load(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(-MAX) : []
  } catch {
    return []
  }
}

interface DismissedChecks {
  keys: string[]
  dismiss: (key: string) => void
}

export const useDismissedChecks = create<DismissedChecks>((set, get) => ({
  keys: load(),
  dismiss: (key) => {
    if (get().keys.includes(key)) return
    const keys = [...get().keys, key].slice(-MAX)
    set({ keys })
    try {
      localStorage.setItem(KEY, JSON.stringify(keys))
    } catch {
      /* kept for this session */
    }
  },
}))
