/**
 * Keyboard mapping for the Standard present view. Pure so it is testable
 * without a DOM; the hook in present-workspace wires it to `window`.
 */
export type PresentKeyAction = "next" | "prev" | "clear" | "restore" | "verseNext" | "versePrev"

interface KeyLike {
  key: string
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
}

/** Shortcuts must never fire while the operator is typing. */
/** A dialog, menu, popover or list has the keys (RG-09): Next/Clear must not act behind it. */
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]'
const OPEN_MODAL = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'

export function shouldIgnoreKeyboard(target: EventTarget | null): boolean {
  if (typeof document !== "undefined" && document.querySelector?.(OPEN_MODAL)) return true
  if (!target || typeof (target as HTMLElement).tagName !== "string") return false
  const el = target as HTMLElement
  if (el.closest?.(OVERLAY)) return true
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
      return e.shiftKey ? "verseNext" : "next"
    case "ArrowLeft":
    case "PageUp":
      return e.shiftKey ? "versePrev" : "prev"
    case "Escape":
      return e.shiftKey ? "restore" : "clear"
    default:
      return null
  }
}
