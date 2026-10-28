/**
 * OBS's own answers about its outputs and inputs (#197 video console, #213 "check OBS online output
 * separately"): the stream and the recording (GetStreamStatus, GetRecordStatus), its render and
 * output frames (GetStats), its inputs, their mute state and audio levels (GetInputList,
 * GetInputMute, InputVolumeMeters). Read only: nothing here changes OBS. A figure OBS did not send
 * is null and shown as not reported, never guessed.
 */

export interface ObsOutputStatus {
  active: boolean
  /** The stream is trying to reconnect (OBS's own flag). */
  reconnecting: boolean
  paused: boolean
  timecode: string | null
  durationMs: number | null
  bytes: number | null
  /** Kilobits a second worked out from OBS's byte count between two readings; null until two. */
  kbps: number | null
  /** Frames the encoder or network could not send (the stream), as OBS counts them. */
  skippedFrames: number | null
  totalFrames: number | null
  /** OBS's congestion figure, 0 to 1 (the stream). */
  congestion: number | null
}

export interface ObsStats {
  cpu: number | null
  fps: number | null
  renderSkipped: number | null
  renderTotal: number | null
  outputSkipped: number | null
  outputTotal: number | null
}

export interface ObsInput {
  name: string
  kind: string
  /** null: OBS says this input has no audio (or has not answered). */
  muted: boolean | null
  /** The loudest channel's peak just now, in dBFS; -Infinity is silence; null when OBS sends no meter for it. */
  levelDb: number | null
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)

/** One output's status as OBS sent it, with the bitrate from the bytes since the previous reading. */
export function obsOutput(r: Record<string, unknown>, prev: { bytes: number; at: number } | null, at: number): ObsOutputStatus {
  const active = r.outputActive === true
  const bytes = num(r.outputBytes)
  const kbps = active && bytes !== null && prev && at > prev.at && bytes >= prev.bytes ? ((bytes - prev.bytes) * 8) / (at - prev.at) : null
  return {
    active,
    reconnecting: active && r.outputReconnecting === true,
    paused: active && r.outputPaused === true,
    timecode: active && typeof r.outputTimecode === "string" ? r.outputTimecode : null,
    durationMs: active ? num(r.outputDuration) : null,
    bytes,
    kbps,
    skippedFrames: num(r.outputSkippedFrames),
    totalFrames: num(r.outputTotalFrames),
    congestion: num(r.outputCongestion),
  }
}

export function obsStats(r: Record<string, unknown>): ObsStats {
  return {
    cpu: num(r.cpuUsage),
    fps: num(r.activeFps),
    renderSkipped: num(r.renderSkippedFrames),
    renderTotal: num(r.renderTotalFrames),
    outputSkipped: num(r.outputSkippedFrames),
    outputTotal: num(r.outputTotalFrames),
  }
}

/** OBS's input list (GetInputList), names and kinds only. */
export function obsInputList(list: unknown): Array<{ name: string; kind: string }> {
  if (!Array.isArray(list)) return []
  return list
    .filter((x): x is { inputName: string; inputKind?: unknown; unversionedInputKind?: unknown } => typeof x?.inputName === "string")
    .map((x) => ({ name: x.inputName, kind: typeof x.unversionedInputKind === "string" ? x.unversionedInputKind : typeof x.inputKind === "string" ? x.inputKind : "" }))
}

/**
 * The InputVolumeMeters event: per input, each channel's [magnitude, peak, input peak] as a
 * multiplier. The loudest channel's peak in dBFS (-Infinity for silence).
 */
export function meterLevels(data: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {}
  const inputs = Array.isArray(data.inputs) ? data.inputs : []
  for (const i of inputs as Array<{ inputName?: unknown; inputLevelsMul?: unknown }>) {
    if (typeof i?.inputName !== "string" || !Array.isArray(i.inputLevelsMul)) continue
    let peak = 0
    for (const ch of i.inputLevelsMul as unknown[]) {
      const p = Array.isArray(ch) ? num(ch[1]) : null
      if (p !== null && p > peak) peak = p
    }
    out[i.inputName] = peak > 0 ? 20 * Math.log10(peak) : -Infinity
  }
  return out
}

/** "1:02:03" or "12:03" from milliseconds. */
export function durationWords(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`
}

/** "2.5 Mbit/s" or "800 kbit/s". */
export function bitrateWords(kbps: number): string {
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbit/s` : `${Math.round(kbps)} kbit/s`
}

/** "12 of 54,000 frames dropped (0.02%)". */
export function droppedWords(skipped: number, total: number): string {
  const pct = total > 0 ? (skipped / total) * 100 : 0
  return `${skipped.toLocaleString("en")} of ${total.toLocaleString("en")} frames dropped (${pct < 0.1 && skipped > 0 ? "<0.1" : pct.toFixed(1)}%)`
}

/** More than this share of frames dropped is worth a warning. */
export const DROPPED_WARN = 0.01

export interface ObsLine {
  text: string
  tone: "ok" | "warn" | "live" | "off"
}

/** The stream in words: live (for how long, bitrate, dropped), reconnecting, or not live. */
export function streamWords(s: ObsOutputStatus | null): ObsLine {
  if (!s) return { text: "Not reported", tone: "off" }
  if (!s.active) return { text: "Not streaming", tone: "off" }
  if (s.reconnecting) return { text: "Reconnecting to the stream service", tone: "warn" }
  const parts = [`Live${s.durationMs !== null ? ` for ${durationWords(s.durationMs)}` : s.timecode ? ` ${s.timecode.split(".")[0]}` : ""}`]
  if (s.kbps !== null) parts.push(bitrateWords(s.kbps))
  if (s.skippedFrames !== null && s.totalFrames !== null && s.totalFrames > 0) parts.push(droppedWords(s.skippedFrames, s.totalFrames))
  const dropping = s.skippedFrames !== null && s.totalFrames !== null && s.totalFrames > 0 && s.skippedFrames / s.totalFrames > DROPPED_WARN
  return { text: parts.join(" · "), tone: dropping ? "warn" : "live" }
}

/** The recording in words: recording (for how long, bitrate), paused, or not recording. */
export function recordWords(r: ObsOutputStatus | null): ObsLine {
  if (!r) return { text: "Not reported", tone: "off" }
  if (!r.active) return { text: "Not recording", tone: "off" }
  const time = r.durationMs !== null ? durationWords(r.durationMs) : r.timecode ? r.timecode.split(".")[0] : null
  const parts = [`${r.paused ? "Paused" : "Recording"}${time ? ` at ${time}` : ""}`]
  if (r.kbps !== null && !r.paused) parts.push(bitrateWords(r.kbps))
  return { text: parts.join(" · "), tone: r.paused ? "warn" : "live" }
}

/** OBS's render and encoder in words: frames a second, CPU, frames it missed. */
export function statsWords(s: ObsStats | null): ObsLine {
  if (!s) return { text: "Not reported", tone: "off" }
  const parts: string[] = []
  if (s.fps !== null) parts.push(`${Math.round(s.fps)} fps`)
  if (s.cpu !== null) parts.push(`CPU ${Math.round(s.cpu)}%`)
  const missedRender = s.renderSkipped !== null && s.renderTotal !== null && s.renderTotal > 0 ? s.renderSkipped / s.renderTotal : 0
  const missedOutput = s.outputSkipped !== null && s.outputTotal !== null && s.outputTotal > 0 ? s.outputSkipped / s.outputTotal : 0
  if (s.renderSkipped !== null && s.renderTotal !== null && s.renderTotal > 0) parts.push(`${s.renderSkipped.toLocaleString("en")} frames missed rendering`)
  if (s.outputSkipped !== null && s.outputTotal !== null && s.outputTotal > 0) parts.push(`${s.outputSkipped.toLocaleString("en")} missed encoding`)
  return { text: parts.join(" · ") || "Not reported", tone: missedRender > DROPPED_WARN || missedOutput > DROPPED_WARN ? "warn" : "ok" }
}

/** An input's sound in words: muted, silent, or its level. */
export function levelWords(i: ObsInput): string {
  if (i.muted === null) return ""
  if (i.muted) return "Muted"
  if (i.levelDb === null) return "On"
  if (i.levelDb === -Infinity || i.levelDb < -60) return "On · silent"
  return `On · ${Math.round(i.levelDb)} dBFS`
}

/** 0 to 1 for a meter bar from -60 dBFS to 0. */
export function meterFill(db: number | null): number {
  if (db === null || db === -Infinity) return 0
  return Math.min(1, Math.max(0, (db + 60) / 60))
}
