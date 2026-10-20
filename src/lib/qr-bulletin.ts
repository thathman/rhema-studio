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
