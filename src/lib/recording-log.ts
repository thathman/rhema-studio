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

export function recordingLogEntries(
  prev: RecorderLogStatus | null,
  next: RecorderLogStatus,
  outputName: (id: string) => string,
  loggedFailures: Set<string>,
): Array<{ phase: RecordingPhase; label: string }> {
  // The first status seen (the app opening) is not a change: nothing is claimed about it.
  if (!prev) return []
  const started = { phase: "started" as const, label: `Recording started${next.outputId ? `: ${outputName(next.outputId)}` : ""}` }
  // A stop and a new start inside one status poll: the recording changed, though the state did not.
  const newSession = !!prev.sessionId && !!next.sessionId && prev.sessionId !== next.sessionId
  if (prev.state === "recording" && next.state === "recording") {
    return newSession ? [{ phase: "stopped", label: "Recording stopped" }, started] : []
  }
  if (prev.state === next.state) return []
  if (next.state === "recording" && prev.state !== "finalizing") return [started]
  if (next.state === "saved" && (prev.state === "recording" || prev.state === "finalizing")) {
    const dropped = next.video?.framesDropped ?? 0
    return [{ phase: "stopped", label: `Recording stopped after ${Math.round((next.elapsedMs ?? 0) / 1000)} s${dropped ? ` · ${dropped} frames dropped` : ""}` }]
  }
  // The file did not close properly but has something in it: stopped, and History can recover it.
  if (next.state === "recoverable" && (prev.state === "recording" || prev.state === "finalizing")) {
    return [{ phase: "stopped", label: `Recording stopped; its file did not close properly and can be recovered in History${next.problem?.message ? ` (${next.problem.message})` : ""}` }]
  }
  if (next.state === "failed") {
    const key = next.sessionId ?? next.startedAt ?? `${prev.state}-${next.problem?.message ?? ""}`
    if (loggedFailures.has(key)) return []
    loggedFailures.add(key)
    return [{ phase: "failed", label: `Recording failed: ${next.problem?.message ?? "the recorder stopped"}` }]
  }
  return []
}
