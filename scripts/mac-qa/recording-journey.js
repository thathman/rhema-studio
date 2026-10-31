// Native app smoke journey for Rhema's local recorder: main-desk start, host-checked output,
// explicit silent QA mode, frame tee, marker, finalization, and History archive listing.
const waitFor = async (predicate, label, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await predicate()
    if (value) return value
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

const invoke = (command, args) => window.__TAURI_INTERNALS__.invoke(command, args)
const request = {
  outputId: "main",
  outputName: "QA Main Output",
  outputRole: "congregation",
  audioDeviceId: null,
  allowSilent: true,
  profile: "standard_720p30",
  serviceRunId: null,
  programId: null,
  rehearsal: false,
}

let sessionActive = false
let sessionId = null
try {
  const preflight = await invoke("recorder_preflight", { request })
  if (!preflight.ok) throw new Error(`Preflight refused: ${JSON.stringify(preflight.problems)}`)
  if (preflight.width !== 1280 || preflight.height !== 720) {
    throw new Error(`Unexpected recorder size: ${preflight.width}x${preflight.height}`)
  }

  const started = await invoke("recorder_start", { request })
  // A successful start owns a session even if an older/stale binary omits the status field.
  // Mark it active before validating the payload so failure cleanup still stops the writer.
  sessionActive = true
  sessionId = started.sessionId
  if (started.sessionActive !== true || started.state !== "recording" || started.outputId !== "main") {
    throw new Error(`Recorder did not confirm the pinned native session: ${JSON.stringify(started)}`)
  }

  const marker = await invoke("recorder_marker", {
    label: "Native QA marker",
    serviceRunId: null,
    itemId: null,
  })
  const writing = await waitFor(async () => {
    const status = await invoke("recorder_status")
    if (status.state !== "recording" || status.sessionId !== sessionId || status.outputId !== "main") {
      throw new Error(`Unexpected active recorder state: ${JSON.stringify(status)}`)
    }
    return status.video.framesWritten >= 60 ? status : null
  }, "at least two seconds of frames from the pinned output", 15000)

  const stopped = await invoke("recorder_stop")
  sessionActive = stopped.sessionActive === true
  if (sessionActive || stopped.state !== "saved") {
    throw new Error(`Recording did not finalize as saved: ${JSON.stringify(stopped)}`)
  }
  if (stopped.sessionId !== sessionId || stopped.outputId !== "main") {
    throw new Error("Stopped recording changed its session or pinned output")
  }
  if (stopped.video.framesWritten < 60 || !stopped.file.path || stopped.file.bytes <= 0) {
    throw new Error(`Saved file has no verified frames or bytes: ${JSON.stringify(stopped)}`)
  }

  const history = await invoke("recorder_list", { rehearsal: false })
  const manifest = history.find((entry) => entry.sessionId === sessionId)
  if (!manifest || manifest.state !== "saved" || manifest.files?.mp4 !== "recording.mp4") {
    throw new Error(`Finalized session is absent from History: ${JSON.stringify(history)}`)
  }
  if (!manifest.markers?.some((entry) => entry.label === "Native QA marker")) {
    throw new Error("History did not retain the session marker")
  }

  return {
    outputId: stopped.outputId,
    state: stopped.state,
    sessionActive: stopped.sessionActive,
    sessionId,
    framesObservedWhileRecording: writing.video.framesWritten,
    framesWritten: stopped.video.framesWritten,
    framesDropped: stopped.video.framesDropped,
    audioDeviceId: stopped.audio.deviceId,
    explicitSilentMode: request.allowSilent,
    marker,
    historyManifest: manifest,
    file: stopped.file,
  }
} finally {
  if (sessionActive) await invoke("recorder_stop").catch(() => {})
}
