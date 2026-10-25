import type { StageClock, StageStyle } from "@/types"
import { validTimeZone } from "@/lib/church-time"

/**
 * The time of day on stage views (#196 R2.6): 12- or 24-hour as the stage design chooses, on the
 * church's clock, with an optional second time zone ("London 09:42") for a guest or an online
 * audience abroad. Pure; the host works it out once a minute and every stage screen shows the same.
 */
export function clockText(ms: number, zone = "", hours: 12 | 24 = 24): string {
  const opts: Intl.DateTimeFormatOptions = hours === 12 ? { hour: "numeric", minute: "2-digit", hour12: true } : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
  const z = validTimeZone(zone)
  return new Date(ms).toLocaleTimeString(hours === 12 ? "en-US" : "en-GB", { ...opts, ...(z ? { timeZone: z } : {}) })
}

/** "Europe/London" → "London", "America/Argentina/Buenos_Aires" → "Buenos Aires". */
export function zoneCity(zone: string): string {
  return (zone.split("/").pop() ?? zone).replace(/_/g, " ")
}

/** What the stage shows for the time of day now, or null when its design has no clock. */
export function stageClock(now: number, style: Pick<StageStyle, "showClock" | "clockHours" | "secondZone" | "secondZoneLabel">, zone = ""): StageClock | null {
  if (!style.showClock) return null
  const hours = style.clockHours === 12 ? 12 : 24
  const second = style.secondZone && validTimeZone(style.secondZone) ? { label: style.secondZoneLabel?.trim() || zoneCity(style.secondZone), time: clockText(now, style.secondZone, hours) } : undefined
  return { time: clockText(now, zone, hours), ...(second ? { second } : {}) }
}
