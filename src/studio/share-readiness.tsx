import { useEffect } from "react"
import { useReadiness } from "@/studio/use-readiness"
import { useSharedReadiness } from "@/lib/desk-consoles"

/**
 * The readiness checks (FR-08, #213 preflight) shared with a joined director's board (desk
 * consoles, #197) through the Live State: the same answer as Home's "Your attention" and Show
 * health. Mounted only while devices are paired; it draws nothing.
 */
export function ShareReadiness() {
  const { ready, checks } = useReadiness()
  const rows = checks.map((c) => ({ id: c.id, status: c.status, label: c.label, ...(c.detail ? { detail: c.detail.slice(0, 200) } : {}) }))
  const key = JSON.stringify([ready, rows])
  useEffect(() => {
    useSharedReadiness.getState().set({ ready, checks: rows })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per change of the checks
  }, [key])
  return null
}
