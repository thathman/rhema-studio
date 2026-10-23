import type { ChipTone } from "@/studio/ui/status-chip"

/**
 * Whether the service being edited is saved, said in words (#299): the one
 * line that tells the operator what Save, Copy, History and Approve act on.
 */
export function saveStateOf(s: { current: { title: string } | null; dirty: boolean; saving: boolean; count: number }): { tone: ChipTone; label: string; title: string } {
  if (s.saving) return { tone: "info", label: "Saving…", title: "Saving this service" }
  if (s.current && s.dirty) return { tone: "warn", label: "Unsaved changes", title: `Changes to "${s.current.title}" are not saved yet. Save keeps them; History has every earlier save.` }
  if (s.current) return { tone: "ok", label: "Saved", title: `Everything here is saved in "${s.current.title}". History has every earlier save.` }
  if (s.count > 0) return { tone: "warn", label: "Not saved as a service", title: "These items are not in a saved service yet. New service saves them as one." }
  return { tone: "off", label: "No service open", title: "Open a saved service, or start one with New service." }
}
