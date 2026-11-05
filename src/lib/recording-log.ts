/**
 * What the service log says about Rhema's own recording (#411, #447 History), from the recorder's
 * state as it changes: a start, a stop (its length and dropped frames) and a failure (its reason,
 * once per recording). It follows the recorder itself, so a start from a paired desk or a failure
 * while Live is closed is logged too; it does not guess who (a desk may have started it).
 */
export type RecorderLogStatus = {
  state: "idle" | "preparing" | "recording" | "finalizing" | "saved" | "recoverable" | "failed"
  sessionId?: string | null
  startedAt?: string | null
  outputId: string | null
  elapsedMs?: number
  video?: { framesDropped?: number }
  problem: { message: string } | null
}

export type RecordingPhase = "started" | "stopped" | "failed"

export function recordingLogEntry(
  prev: RecorderLogStatus | null,
  next: RecorderLogStatus,
  outputName: (id: string) => string,
  loggedFailures: Set<string>,
): { phase: RecordingPhase; label: string } | null {
  // The first status seen (the app opening) is not a change: nothing is claimed about it.
  if (!prev || prev.state === next.state) return null
  if (next.state === "recording" && prev.state !== "finalizing") {
    return { phase: "started", label: `Recording started${next.outputId ? `: ${outputName(next.outputId)}` : ""}` }
  }
  if (next.state === "saved" && (prev.state === "recording" || prev.state === "finalizing")) {
    const dropped = next.video?.framesDropped ?? 0
    return { phase: "stopped", label: `Recording stopped after ${Math.round((next.elapsedMs ?? 0) / 1000)} s${dropped ? ` · ${dropped} frames dropped` : ""}` }
  }
  if (next.state === "failed") {
    const key = next.sessionId ?? next.startedAt ?? `${prev.state}-${next.problem?.message ?? ""}`
    if (loggedFailures.has(key)) return null
    loggedFailures.add(key)
    return { phase: "failed", label: `Recording failed: ${next.problem?.message ?? "the recorder stopped"}` }
  }
  return null
}
