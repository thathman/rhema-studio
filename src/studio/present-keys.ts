/**
 * Keyboard mapping for the Standard present view. Pure so it is testable
 * without a DOM; the hook in present-workspace wires it to `window`.
 */
export type PresentKeyAction = "next" | "prev" | "clear" | "restore"

interface KeyLike {
  key: string
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
}

/** Shortcuts must never fire while the operator is typing. */
export function shouldIgnoreKeyboard(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== "string") return false
  const el = target as HTMLElement
  const tag = el.tagName.toLowerCase()
  if (tag === "input" || tag === "textarea" || tag === "select") return true
  if (el.isContentEditable) return true
  const role = el.getAttribute?.("role")
  return role === "combobox" || role === "textbox"
}

export function keyToPresentAction(e: KeyLike): PresentKeyAction | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null
  switch (e.key) {
    case "ArrowRight":
    case "PageDown":
      return e.shiftKey ? null : "next"
    case "ArrowLeft":
    case "PageUp":
      return e.shiftKey ? null : "prev"
    case "Escape":
      return e.shiftKey ? "restore" : "clear"
    default:
      return null
  }
}
