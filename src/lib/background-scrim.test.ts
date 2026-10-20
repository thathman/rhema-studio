import { describe, expect, it } from "vitest"
import { backgroundScrimAlpha } from "./verse-renderer"
import { CLASSIC_DARK } from "./builtin-themes"
import type { BroadcastTheme } from "@/types"

const base = (): BroadcastTheme => JSON.parse(JSON.stringify(CLASSIC_DARK)) as BroadcastTheme

describe("background scrim", () => {
  it("darkens a photo under light words unless the theme has an opaque text plate", () => {
    const t = base()
    t.verseText.color = "#ffffff"
    t.textBox = { ...t.textBox, enabled: false }
    expect(backgroundScrimAlpha(t)).toBe(0.45)
    t.textBox = { ...t.textBox, enabled: true, image: null, opacity: 0.3 }
    expect(backgroundScrimAlpha(t)).toBeCloseTo(0.3)
    t.textBox = { ...t.textBox, opacity: 0.9 }
    expect(backgroundScrimAlpha(t)).toBe(0)
  })

  it("never darkens for dark words", () => {
    const t = base()
    t.verseText.color = "#111111"
    t.textBox = { ...t.textBox, enabled: false }
    expect(backgroundScrimAlpha(t)).toBe(0)
  })
})
