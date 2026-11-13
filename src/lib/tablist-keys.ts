import type { KeyboardEvent } from "react"

/**
 * Arrow-key movement for a hand-built tab row, the same as the shared Tabs (UX audit X2): ←/→ (and ↑/↓)
 * move to the previous/next tab and select it, Home/End to the first/last. Put it on the element with
 * role="tablist"; its tabs are the [role="tab"] buttons inside, in order.
 */
export function tablistKeys(event: KeyboardEvent<HTMLElement>): void {
  const keys: Record<string, number | "first" | "last"> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: "first", End: "last" }
  const move = keys[event.key]
  if (move === undefined) return
  const tabs = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not([disabled])')]
  if (tabs.length === 0) return
  const at = tabs.indexOf(document.activeElement as HTMLElement)
  const next = move === "first" ? 0 : move === "last" ? tabs.length - 1 : (Math.max(at, 0) + move + tabs.length) % tabs.length
  event.preventDefault()
  tabs[next].focus()
  tabs[next].click()
}
