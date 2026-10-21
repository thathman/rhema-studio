import { useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { useAudioStore } from "@/stores/audio-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useTranscriptStore } from "@/stores/transcript-store"
import { mark } from "@/lib/latency-marks"
import { useTauriEvent } from "./use-tauri-event"
import { useCloudConsentStore } from "@/stores/cloud-consent-store"

interface TranscriptPartialPayload {
  text: string
  is_final: boolean
  confidence: number
}

interface UseTranscriptionOptions {
  /**
   * Called when `start_transcription` fails because the user picked the
   * Deepgram provider but hasn't set an API key. Panels typically react by
   * opening a key-prompt dialog instead of showing the default toast.
   */
  onMissingApiKey?: () => void
}

const MISSING_DEEPGRAM_KEY_MARKER = "No Deepgram API key"
const NOT_RUNNING_ERROR = "Transcription is not running"

export const transcriptionActions = {
  async start(onMissingApiKey?: () => void): Promise<void> {
    const settings = useSettingsStore.getState()
    // RG-08 / NFR-09: no microphone audio leaves this computer until someone here has agreed to it.
    if (settings.sttProvider === "deepgram" && !settings.cloudSpeechConsentAt) {
      useCloudConsentStore.getState().ask(() => void transcriptionActions.start(onMissingApiKey))
      return
    }
    const transcript = useTranscriptStore.getState()
    transcript.setConnectionStatus("connecting")

    try {
      await invoke("start_transcription", {
        apiKey:
          settings.sttProvider === "deepgram"
            ? (settings.deepgramApiKey ?? "")
            : "",
        deviceId: settings.audioDeviceId,
        gain: settings.gain,
        provider: settings.sttProvider,
      })
      transcript.setTranscribing(true)
      // What is actually running (the setting can change mid-session without restarting it).
      useCloudConsentStore.setState({ runningProvider: settings.sttProvider })
    } catch (e) {
      const msg = String(e)
      transcript.setConnectionStatus("error")
      if (msg.includes(MISSING_DEEPGRAM_KEY_MARKER) && onMissingApiKey) {
        onMissingApiKey()
      } else {
        toast.error("Could not start transcription", { description: msg })
      }
    }
  },

  async stop(): Promise<void> {
    const transcript = useTranscriptStore.getState()
    try {
      await invoke("stop_transcription")
    } catch (e) {
      if (String(e) !== NOT_RUNNING_ERROR) {
        toast.error("Could not stop transcription", { description: String(e) })
      }
    }
    transcript.setTranscribing(false)
    useCloudConsentStore.setState({ runningProvider: null })
    transcript.setPartial("")
    transcript.setConnectionStatus("disconnected")
  },
}

export function useTranscription(options?: UseTranscriptionOptions) {
  const segments = useTranscriptStore((s) => s.segments)
  const isTranscribing = useTranscriptStore((s) => s.isTranscribing)
  const connectionStatus = useTranscriptStore((s) => s.connectionStatus)

  const onMissingApiKey = options?.onMissingApiKey

  const startTranscription = useCallback(
    () => transcriptionActions.start(onMissingApiKey),
    [onMissingApiKey]
  )

  return {
    segments,
    isTranscribing,
    connectionStatus,
    startTranscription,
    stopTranscription: transcriptionActions.stop,
  }
}

/**
 * Speech recognition events (connection, errors, a lost microphone, what was
 * heard), handled for the whole app: listening keeps its transcript and its
 * warnings whichever view is on screen. Mount once, at the root.
 */
export function useTranscriptionEvents(): void {
  // STT lifecycle events
  useTauriEvent("stt_connected", () => {
    useTranscriptStore.getState().setConnectionStatus("connected")
  })
  useTauriEvent("stt_disconnected", () => {
    useTranscriptStore.getState().setConnectionStatus("disconnected")
  })
  useTauriEvent<string>("stt_error", (msg) => {
    useTranscriptStore.getState().setConnectionStatus("error")
    toast.error("Transcription error", { description: msg })
  })

  // Audio source lifecycle: when the OS device disappears (mic unplugged,
  // headset disconnects, app loses access) the watchdog in the Rust fanout
  // thread emits `audio_source_lost`, then `audio_source_recovered` once it
  // sees the device return. The STT provider stays alive across the gap.
  useTauriEvent("audio_source_lost", () => {
    useAudioStore.getState().setSourceLost(true)
    toast.warning("Audio source disconnected", {
      description: "Waiting for the device to come back…",
      id: "audio-source-status",
    })
  })
  useTauriEvent("audio_source_recovered", () => {
    useAudioStore.getState().setSourceLost(false)
    toast.success("Audio source reconnected", {
      id: "audio-source-status",
    })
  })

  useTauriEvent<TranscriptPartialPayload>("transcript_partial", (payload) => {
    mark(`transcript_partial received "${payload.text.slice(0, 30)}"`)
    useTranscriptStore.getState().setPartial(payload.text)
  })

  useTauriEvent<TranscriptPartialPayload>("transcript_final", (payload) => {
    mark(`transcript_final received "${payload.text.slice(0, 30)}"`)
    useTranscriptStore.getState().addSegment({
      id: crypto.randomUUID(),
      text: payload.text,
      is_final: true,
      confidence: payload.confidence,
      words: [],
      timestamp: Date.now(),
    })
  })
}

