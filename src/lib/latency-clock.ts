import { clockParts } from "@/lib/glass-latency"

/**
 * The camera-lag clock on an output (#213): a large running clock, seconds and milliseconds, over
 * the test pattern, for a camera to film. It counts by this computer's clock (a browser feed page
 * by the host's, `now`), redrawn every frame the screen shows while it is up.
 */
export function latencyClock(now: () => number = Date.now): { show: (on: boolean) => void } {
  let box: HTMLDivElement | null = null
  let big: HTMLSpanElement | null = null
  let small: HTMLSpanElement | null = null
  let raf = 0
  const tick = () => {
    const p = clockParts(now())
    if (big && big.textContent !== p.seconds) big.textContent = p.seconds
    if (small && small.textContent !== p.minutes) small.textContent = p.minutes
    raf = requestAnimationFrame(tick)
  }
  const make = () => {
    box = document.createElement("div")
    box.setAttribute("role", "timer")
    box.setAttribute("aria-label", "Camera lag clock")
    Object.assign(box.style, { position: "fixed", inset: "0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "2vh", background: "#000000", color: "#ffffff", zIndex: "20", pointerEvents: "none", fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontVariantNumeric: "tabular-nums" })
    small = document.createElement("span")
    Object.assign(small.style, { font: "600 6vh ui-monospace, Menlo, Consolas, monospace", opacity: "0.7" })
    big = document.createElement("span")
    Object.assign(big.style, { font: "700 28vh ui-monospace, Menlo, Consolas, monospace", letterSpacing: "0.02em" })
    const note = document.createElement("span")
    note.textContent = "TEST – not on air · camera lag clock"
    Object.assign(note.style, { font: "500 3.2vh system-ui, sans-serif", opacity: "0.7" })
    box.append(small, big, note)
    document.body.appendChild(box)
  }
  return {
    show(on: boolean) {
      if (on && !box) {
        make()
        tick()
      } else if (!on && box) {
        cancelAnimationFrame(raf)
        box.remove()
        box = big = small = null
      }
    },
  }
}
