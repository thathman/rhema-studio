import QRCode from "qrcode"

/**
 * A link a congregation may scan from the screen. Only http(s), no
 * credentials, no fragments longer than a QR can hold; the text shown next
 * to the code is always the link itself, so nobody scans a surprise.
 */
export function safeLink(raw: string): string | null {
  const t = raw.trim()
  if (!t || t.length > 300) return null
  let u: URL
  try {
    u = new URL(t)
  } catch {
    return null
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null
  if (u.username || u.password) return null
  return u.toString()
}

/** The code as a PNG data URL, drawn large with a quiet zone; the renderer fits it to the frame. */
export async function qrDataUrl(link: string): Promise<string> {
  return QRCode.toDataURL(link, { errorCorrectionLevel: "M", margin: 2, width: 1024, color: { dark: "#000000", light: "#ffffff" } })
}

/**
 * One picture for the output: a white panel with the code on the left and
 * the title, lines and address on the right, so nothing is drawn over the
 * code (a scrim or text across it would stop it scanning). Without a DOM
 * (tests) the bare code is returned.
 */
export async function composeQrSlide(link: string, title: string, lines: string[]): Promise<string> {
  const code = await qrDataUrl(link)
  if (typeof document === "undefined") return code
  const W = 1920, H = 1080
  const canvas = document.createElement("canvas")
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext("2d")
  if (!ctx) return code
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error("QR image failed to decode"))
    i.src = code
  })
  // Panel
  const px = 120, py = 120, pw = W - 240, ph = H - 240, r = 32
  ctx.fillStyle = "#ffffff"
  ctx.beginPath()
  ctx.moveTo(px + r, py)
  ctx.arcTo(px + pw, py, px + pw, py + ph, r)
  ctx.arcTo(px + pw, py + ph, px, py + ph, r)
  ctx.arcTo(px, py + ph, px, py, r)
  ctx.arcTo(px, py, px + pw, py, r)
  ctx.closePath()
  ctx.fill()
  // Code (with its own quiet zone) on the left
  const side = ph - 120
  ctx.drawImage(img, px + 60, py + 60, side, side)
  // Words on the right, black on white, wrapped
  const tx = px + 60 + side + 60
  const tw = px + pw - 60 - tx
  ctx.fillStyle = "#111111"
  ctx.textBaseline = "top"
  let y = py + 80
  const wrap = (text: string, font: string, lineHeight: number, max = 6) => {
    ctx.font = font
    const words = text.split(/\s+/).filter(Boolean)
    let line = ""
    let n = 0
    for (const w of words) {
      const next = line ? `${line} ${w}` : w
      if (ctx.measureText(next).width > tw && line) {
        ctx.fillText(line, tx, y)
        y += lineHeight
        line = w
        if (++n >= max) return
      } else line = next
    }
    if (line) {
      ctx.fillText(line, tx, y)
      y += lineHeight
    }
  }
  if (title.trim()) {
    wrap(title.trim(), "bold 84px system-ui, sans-serif", 100, 3)
    y += 24
  }
  for (const l of lines) wrap(l, "48px system-ui, sans-serif", 62, 2)
  y = Math.max(y + 24, py + ph - 60 - 150)
  ctx.fillStyle = "#444444"
  wrap("Scan, or go to", "40px system-ui, sans-serif", 52, 1)
  ctx.fillStyle = "#111111"
  wrap(link, "bold 44px ui-monospace, monospace", 56, 2)
  return canvas.toDataURL("image/png")
}
