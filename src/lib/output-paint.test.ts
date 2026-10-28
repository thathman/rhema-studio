import { describe, expect, it, vi } from "vitest"
import { paintFrame } from "./output-paint"

const fakeCanvas = () => {
  const ctx = { clearRect: vi.fn(), drawImage: vi.fn() }
  return { canvas: { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement, ctx }
}

describe("paintFrame", () => {
  it("copies a good frame to the output", () => {
    const target = fakeCanvas()
    const scratch = fakeCanvas()
    expect(paintFrame(target.canvas, scratch.canvas, 1920, 1080, () => {})).toBe(true)
    expect(target.canvas.width).toBe(1920)
    expect(target.ctx.drawImage).toHaveBeenCalledWith(scratch.canvas, 0, 0)
  })

  it("leaves the output untouched when drawing throws", () => {
    const target = fakeCanvas()
    target.canvas.width = 1280
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(paintFrame(target.canvas, fakeCanvas().canvas, 1920, 1080, () => { throw new Error("broken image") })).toBe(false)
    expect(target.canvas.width).toBe(1280)
    expect(target.ctx.clearRect).not.toHaveBeenCalled()
    expect(target.ctx.drawImage).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
