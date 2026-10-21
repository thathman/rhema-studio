import { useCloudConsentStore } from "@/stores/cloud-consent-store"
import { transcriptionActions } from "@/hooks/use-transcription"
import { useState, useEffect, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"

import { Button } from "@/components/ui/button"
import { DiagnosticsSection } from "@/components/settings/diagnostics-section"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Slider } from "@/components/ui/slider"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar"
import {
  MicIcon,
  TvIcon,
  KeyIcon,
  CheckIcon,
  BookOpenIcon,
  RadioIcon,
  FileTextIcon,
  HelpCircleIcon,
  GraduationCapIcon,
  BrainCircuitIcon,
} from "lucide-react"
import { LevelMeter } from "@/components/ui/level-meter"
import { useAudioTest } from "@/hooks/use-audio-test"
import { useBibleStore, useSettingsStore } from "@/stores"
import { useTranscriptStore } from "@/stores/transcript-store"
import { useTutorialStore } from "@/stores/tutorial-store"
import { useSettingsDialogStore } from "@/lib/settings-dialog"
import { useObsStore } from "@/stores/obs-store"
import { REMOTE_EVENTS } from "@/lib/remote-events"
import { qrDataUrl } from "@/lib/qr-bulletin"
import type { DeviceInfo } from "@/types/audio"

/* -------------------------------------------------------------------------- */
/*  Nav definition                                                            */
/* -------------------------------------------------------------------------- */

type NavSection =
  | "audio"
  | "speech"
  | "bible"
  | "display"
  | "api-keys"
  | "remote"
  | "diagnostics"
  | "help"

const navItems: { name: string; id: NavSection; icon: React.ReactNode }[] = [
  {
    name: "Audio",
    id: "audio",
    icon: <MicIcon strokeWidth={2} />,
  },
  {
    name: "Speech Recognition",
    id: "speech",
    icon: <BrainCircuitIcon strokeWidth={2} />,
  },
  {
    name: "Bible",
    id: "bible",
    icon: <BookOpenIcon strokeWidth={2} />,
  },
  {
    name: "Display Mode",
    id: "display",
    icon: <TvIcon strokeWidth={2} />,
  },
  {
    name: "Remote Control",
    id: "remote",
    icon: <RadioIcon strokeWidth={2} />,
  },
  {
    name: "API Keys",
    id: "api-keys",
    icon: <KeyIcon strokeWidth={2} />,
  },
  {
    name: "Diagnostics",
    id: "diagnostics",
    icon: <FileTextIcon strokeWidth={2} />,
  },
  {
    name: "Help",
    id: "help",
    icon: <HelpCircleIcon strokeWidth={2} />,
  },
]

/* -------------------------------------------------------------------------- */
/*  Section: Audio                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Isolated leaf so the ~15 Hz `audio_level` ticks during a test re-render
 * only this row, not the whole settings dialog (same pattern as the
 * transcript panel's meter).
 */
function AudioTestRow() {
  const { isTesting, level, toggle } = useAudioTest()
  const isTranscribing = useTranscriptStore((s) => s.isTranscribing)

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Test Input
      </label>
      <div className="flex items-center gap-3">
        <LevelMeter level={level} bars={6} className="h-5 flex-1" />
        <Button
          size="sm"
          variant={isTesting ? "destructive" : "outline"}
          disabled={isTranscribing}
          onClick={() => void toggle()}
        >
          {isTesting ? "Stop" : "Test"}
        </Button>
      </div>
      <p className="text-[0.625rem] text-muted-foreground">
        {isTranscribing
          ? "Testing is unavailable while transcription is running."
          : "Captures from the selected device to verify it works. Gain changes apply on the next test. Stops automatically after 60 seconds."}
      </p>
    </div>
  )
}

function AudioSection() {
  const {
    audioDeviceId,
    setAudioDeviceId,
    gain,
    setGain,
  } = useSettingsStore()

  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [loading, setLoading] = useState(true)

  // Devices load once; state is set when the call settles (not synchronously in the effect).
  useEffect(() => {
    let cancelled = false
    invoke<DeviceInfo[]>("get_audio_devices")
      .catch(() => [] as DeviceInfo[]) // the command may not be available during dev
      .then((result) => {
        if (cancelled) return
        setDevices(result)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // gain is 0.0-2.0 in store, display as 0-100%
  const gainPercent = Math.round((gain / 2.0) * 100)

  return (
    <div className="flex flex-col gap-6">
      {/* Device selector */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Input Device
        </label>
        <Select
          value={audioDeviceId ?? "__default__"}
          onValueChange={(v) => setAudioDeviceId(v === "__default__" ? null : v)}
          disabled={loading}
        >
          <SelectTrigger aria-label="Microphone" className="h-8 text-xs">
            <SelectValue
              placeholder={loading ? "Loading devices..." : "System default"}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__default__">System default</SelectItem>
            {devices.map((device) => (
              <SelectItem key={device.id} value={device.id}>
                {device.name}
                {device.is_default ? " (default)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[0.625rem] text-muted-foreground">
          Selected device persists across sessions. Leave as system default to
          follow OS audio routing.
        </p>
      </div>

      {/* Test input */}
      <AudioTestRow />

      {/* Input gain */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Input Gain
          </label>
          <span className="text-xs tabular-nums text-muted-foreground">
            {gainPercent}%
          </span>
        </div>
        <Slider
          aria-label="Microphone gain"
          min={0}
          max={100}
          step={1}
          value={[gainPercent]}
          onValueChange={([v]) => setGain((v / 100) * 2.0)}
        />
        <p className="text-[0.625rem] text-muted-foreground">
          Amplifies the incoming audio signal before transcription. 50% is unity
          gain.
        </p>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Section: Speech Recognition                                               */
/* -------------------------------------------------------------------------- */

function SpeechSection() {
  const {
    sttProvider,
    setSttProvider,
    deepgramApiKey,
    setDeepgramApiKey,
  } = useSettingsStore()

  const [keyValue, setKeyValue] = useState(deepgramApiKey ?? "")
  const [saved, setSaved] = useState(false)

  const handleSaveKey = () => {
    setDeepgramApiKey(keyValue || null)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Provider selector */}
      <div className="flex flex-col gap-3">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Provider
        </label>

        <RadioGroup
          value={sttProvider}
          onValueChange={(v) => setSttProvider(v as "deepgram" | "whisper")}
          className="gap-3"
        >
          {/* Deepgram (cloud) */}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-data-[state=checked]:border-primary/50 has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:ring-1 has-data-[state=checked]:ring-primary/20 ${
              sttProvider !== "deepgram" ? "hover:border-muted-foreground/25" : ""
            }`}
          >
            <RadioGroupItem value="deepgram" className="mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground">
                Cloud (Deepgram)
              </span>
              <p className="text-[0.625rem] leading-relaxed text-muted-foreground">
                Uses Deepgram Nova-3 for real-time streaming transcription.
                Requires an API key and internet connection. Best accuracy with
                keyword boosting for Bible terms. While listening, the microphone
                sound is sent to Deepgram (USA); you are asked once before it first starts.
              </p>
              <CloudConsentLine />
            </div>
          </label>

          {/* Whisper (local) */}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-data-[state=checked]:border-primary/50 has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:ring-1 has-data-[state=checked]:ring-primary/20 ${
              sttProvider !== "whisper" ? "hover:border-muted-foreground/25" : ""
            }`}
          >
            <RadioGroupItem value="whisper" className="mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground">
                Local (Whisper)
              </span>
              <p className="text-[0.625rem] leading-relaxed text-muted-foreground">
                Runs Whisper large-v3-turbo locally on your device. Fully
                offline, no API key needed. Audio never leaves your machine.
              </p>
            </div>
          </label>
        </RadioGroup>
      </div>

      {/* Deepgram settings — show when deepgram is selected */}
      {sttProvider === "deepgram" && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Deepgram API Key
            </label>
            {deepgramApiKey && (
              <Badge variant="outline" className="text-[0.5rem]">
                Key configured
              </Badge>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder="Enter your Deepgram API key..."
              value={keyValue}
              onChange={(e) => setKeyValue(e.target.value)}
              className="flex-1 text-xs"
            />
            <Button size="sm" onClick={handleSaveKey}>
              {saved ? (
                <>
                  <CheckIcon className="size-3" />
                  Saved
                </>
              ) : (
                "Save"
              )}
            </Button>
          </div>
          <p className="text-[0.625rem] text-muted-foreground">
            Required for live transcription. Get a key at{" "}
            <span className="text-primary">deepgram.com</span>
          </p>
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Section: Display Mode                                                     */
/* -------------------------------------------------------------------------- */

function DisplayModeSection() {
  const {
    autoMode,
    setAutoMode,
    confidenceThreshold,
    setConfidenceThreshold,
  } = useSettingsStore()

  const thresholdPercent = Math.round(confidenceThreshold * 100)

  return (
    <div className="flex flex-col gap-6">
      {/* Mode selector */}
      <div className="flex flex-col gap-3">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Broadcast Mode
        </label>

        <RadioGroup
          value={autoMode ? "auto" : "manual"}
          onValueChange={(v) => setAutoMode(v === "auto")}
          className="gap-3"
        >
          {/* Auto mode */}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-data-[state=checked]:border-primary/50 has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:ring-1 has-data-[state=checked]:ring-primary/20 ${
              !autoMode ? "hover:border-muted-foreground/25" : ""
            }`}
          >
            <RadioGroupItem value="auto" className="mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground">Auto</span>
              <p className="text-[0.625rem] leading-relaxed text-muted-foreground">
                Automatically displays the highest-confidence detected verse on
                broadcast output. A 2.5-second cooldown prevents rapid flickering.
                Best for hands-off operation.
              </p>
            </div>
          </label>

          {/* Manual mode */}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-data-[state=checked]:border-primary/50 has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:ring-1 has-data-[state=checked]:ring-primary/20 ${
              autoMode ? "hover:border-muted-foreground/25" : ""
            }`}
          >
            <RadioGroupItem value="manual" className="mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground">Manual</span>
              <p className="text-[0.625rem] leading-relaxed text-muted-foreground">
                Nothing goes to broadcast until you explicitly send it. Detected
                verses still appear in the AI Detections panel and queue, but you
                decide which ones to display and when. Best for important services.
              </p>
            </div>
          </label>
        </RadioGroup>
      </div>

      {/* Confidence threshold — only when auto */}
      {autoMode && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Confidence Threshold
            </label>
            <span className="text-xs tabular-nums text-muted-foreground">
              {thresholdPercent}%
            </span>
          </div>
          <Slider
            min={35}
            max={100}
            step={1}
            value={[thresholdPercent]}
            onValueChange={([v]) => setConfidenceThreshold(v / 100)}
          />
          <p className="text-[0.625rem] text-muted-foreground">
            Only verses with confidence above this threshold will be sent to
            broadcast automatically. Higher values reduce false positives.
          </p>
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Section: API Keys                                                         */
/* -------------------------------------------------------------------------- */

function ApiKeysSection() {
  const { deepgramApiKey, sttProvider } = useSettingsStore()

  return (
    <div className="flex flex-col gap-6">
      {/* Deepgram key status (configured in Speech Recognition section) */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Deepgram API Key
          </label>
          {deepgramApiKey ? (
            <Badge variant="outline" className="text-[0.5rem]">
              Key configured
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[0.5rem] text-muted-foreground">
              Not set
            </Badge>
          )}
        </div>
        <p className="text-[0.625rem] text-muted-foreground">
          {sttProvider === "whisper"
            ? "Not required when using local Whisper. "
            : "Required for cloud transcription. "}
          Configure in the Speech Recognition section.
        </p>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Section titles                                                            */
/* -------------------------------------------------------------------------- */

const sectionTitles: Record<NavSection, string> = {
  audio: "Audio",
  speech: "Speech Recognition",
  bible: "Bible Translation",
  display: "Display Mode",
  remote: "Remote Control",
  "api-keys": "API Keys",
  diagnostics: "Diagnostics",
  help: "Help",
}

/* -------------------------------------------------------------------------- */
/*  Section: Bible Translation                                                */
/* -------------------------------------------------------------------------- */

interface TranslationInfo {
  id: number
  abbreviation: string
  title: string
  language: string
}

function BibleSection() {
  const [translations, setTranslations] = useState<TranslationInfo[]>([])
  const [activeId, setActiveId] = useState<number>(1)
  const secondaryId = useBibleStore((state) => state.secondaryTranslationId)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [trans, active] = await Promise.all([
          invoke<TranslationInfo[]>("list_translations"),
          invoke<number>("get_active_translation"),
        ])
        setTranslations(trans)
        setActiveId(active)
      } catch (e) {
        console.error("Failed to load translations:", e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleChange = async (value: string) => {
    const id = parseInt(value)
    try {
      await invoke("set_active_translation", { translationId: id })
      setActiveId(id)
      // Update frontend stores so all panels use the new translation
      const { useBibleStore } = await import("@/stores")
      useBibleStore.getState().setActiveTranslation(id)
    } catch (e) {
      console.error("Failed to set translation:", e)
    }
  }

  const englishTranslations = translations.filter((t) => t.language === "en")
  const otherTranslations = translations.filter((t) => t.language !== "en")
  const handleSecondaryChange = (value: string) => {
    useBibleStore
      .getState()
      .setSecondaryTranslation(value === "__none__" ? null : parseInt(value))
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Primary Translation
        </label>
        <Select
          value={String(activeId)}
          onValueChange={handleChange}
          disabled={loading}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder={loading ? "Loading..." : "Select translation"} />
          </SelectTrigger>
          <SelectContent>
            {englishTranslations.length > 0 && (
              <>
                <div className="px-2 py-1 text-[0.5625rem] font-medium uppercase tracking-wider text-muted-foreground">
                  English
                </div>
                {englishTranslations.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.abbreviation} — {t.title}
                  </SelectItem>
                ))}
              </>
            )}
            {otherTranslations.length > 0 && (
              <>
                <div className="mt-1 px-2 py-1 text-[0.5625rem] font-medium uppercase tracking-wider text-muted-foreground">
                  Other Languages
                </div>
                {otherTranslations.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.abbreviation} — {t.title}
                  </SelectItem>
                ))}
              </>
            )}
          </SelectContent>
        </Select>
        <p className="text-[0.625rem] text-muted-foreground">
          Detected verses will display in this translation.
          {translations.length > 0 && ` ${translations.length} translations available.`}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Secondary Translation
        </label>
        <Select
          value={secondaryId === null ? "__none__" : String(secondaryId)}
          onValueChange={handleSecondaryChange}
          disabled={loading}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder={loading ? "Loading..." : "None"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">None</SelectItem>
            {translations
              .filter((translation) => translation.id !== activeId)
              .map((translation) => (
                <SelectItem key={translation.id} value={String(translation.id)}>
                  {translation.abbreviation} — {translation.title}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <p className="text-[0.625rem] text-muted-foreground">
          When selected, the live output shows both translations for every
          detected reference.
        </p>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Section: Remote Control                                                   */
/* -------------------------------------------------------------------------- */

interface RemoteStatus {
  running: boolean
  port: number | null
  /** HTTP only: the running server accepts other devices (not just this computer). */
  lan?: boolean
}

interface CommandLogEntry {
  id: number
  timestamp: string
  source: "OSC" | "HTTP"
  command: string
}

function RemoteControlSection() {
  const [oscPort, setOscPort] = useState("8000")
  const [httpPort, setHttpPort] = useState("8080")
  // Applies to both listeners at their next start. Nothing here authenticates,
  // so this is the only gate between the network and the live output.
  const [remoteLan, setRemoteLan] = useState(true)
  const remoteSecret = useSettingsStore((s) => s.remoteSecret)
  const setRemoteSecret = useSettingsStore((s) => s.setRemoteSecret)
  const remoteDevices = useSettingsStore((s) => s.remoteDevices)
  const revokeRemoteDevice = useSettingsStore((s) => s.revokeRemoteDevice)
  const setRemoteDeviceRole = useSettingsStore((s) => s.setRemoteDeviceRole)
  const remoteAuthRequired = useSettingsStore((s) => s.remoteAuthRequired)
  const setRemoteAuthRequired = useSettingsStore((s) => s.setRemoteAuthRequired)
  const anyKey = remoteSecret.trim().length > 0 || remoteDevices.length > 0
  const [pairCode, setPairCode] = useState<string | null>(null)
  const [pairStartedAt, setPairStartedAt] = useState("")
  // The backend closes the window when a device pairs; hide the code once a device newer than the window appears.
  const showPairCode = pairCode !== null && !remoteDevices.some((d) => d.paired_at > pairStartedAt)
  const pairTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pairQr, setPairQr] = useState<{ host: string; url: string; image: string } | null>(null)
  /** Rebuild the code for another address (a VPN or second network card can make the guess wrong). */
  const showPairQr = async (host: string, code: string, port: number) => {
    const url = `http://${host}:${port}/remote#code=${code}`
    setPairQr({ host, url, image: await qrDataUrl(url) })
  }
  const startPairing = async () => {
    try {
      const code = await invoke<string>("remote_pair_start")
      setPairStartedAt(new Date().toISOString())
      setPairCode(code)
      setPairQr(null)
      // A phone scans this to open the remote page with the code filled in (in the
      // fragment, so it never reaches a server log). Only offered when the running
      // server accepts other devices (asked from the server; the tickbox may have changed since).
      const status = await invoke<RemoteStatus>("get_http_status").catch(() => null)
      const ip = status?.lan ? await invoke<string | null>("remote_lan_address").catch(() => null) : null
      if (status?.lan && status.port) await showPairQr(ip ?? "", code, status.port)
      if (pairTimer.current) clearTimeout(pairTimer.current)
      pairTimer.current = setTimeout(() => setPairCode(null), 120_000)
    } catch (e) {
      setHttpError(String(e))
    }
  }
  const cancelPairing = async () => {
    setPairCode(null)
    if (pairTimer.current) clearTimeout(pairTimer.current)
    await invoke("remote_pair_cancel").catch(() => {})
  }
  useEffect(() => {
    // The backend closes the window on pairing, expiry or three wrong codes; closing Settings closes it too.
    const closed = () => setPairCode(null)
    window.addEventListener("rhema:pair-closed", closed)
    return () => {
      window.removeEventListener("rhema:pair-closed", closed)
      if (pairTimer.current) clearTimeout(pairTimer.current)
      void invoke("remote_pair_cancel").catch(() => {})
    }
  }, [])

  const [oscStatus, setOscStatus] = useState<RemoteStatus>({ running: false, port: null })
  const [httpStatus, setHttpStatus] = useState<RemoteStatus>({ running: false, port: null })
  const [oscError, setOscError] = useState<string | null>(null)
  const [httpError, setHttpError] = useState<string | null>(null)
  const [commandLog, setCommandLog] = useState<CommandLogEntry[]>([])
  const logIdRef = useRef(0)

  // Poll statuses
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const osc = await invoke<RemoteStatus>("get_osc_status")
        setOscStatus(osc)
        if (osc.running) setOscError(null)
      } catch { /* ignore */ }
      try {
        const http = await invoke<RemoteStatus>("get_http_status")
        setHttpStatus(http)
        if (http.running) setHttpError(null)
      } catch { /* ignore */ }
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  // Listen for remote commands to populate the log
  useEffect(() => {
    let cancelled = false
    const unlisteners: (() => void)[] = []

    async function setup() {
      const { listen } = await import("@tauri-apps/api/event")

      for (const event of Object.values(REMOTE_EVENTS)) {
        const unlisten = await listen(event, () => {
          if (cancelled) return
          const entry: CommandLogEntry = {
            id: logIdRef.current++,
            timestamp: new Date().toLocaleTimeString(),
            source: "OSC", // We can't distinguish source at event level; default to OSC
            command: event.replace("remote:", ""),
          }
          setCommandLog((prev) => [entry, ...prev].slice(0, 50))
        })
        unlisteners.push(unlisten)
      }
    }

    setup()
    return () => {
      cancelled = true
      unlisteners.forEach((fn) => fn())
    }
  }, [])

  const handleOscToggle = async () => {
    try {
      if (oscStatus.running) {
        await invoke("stop_osc")
        setOscError(null)
      } else {
        const port = parseInt(oscPort) || 8000
        const boundPort = await invoke<number>("start_osc", { port, lan: remoteLan })
        setOscPort(String(boundPort))
        setOscError(null)
      }
    } catch (e) {
      setOscError(String(e))
    }
  }

  const handleHttpToggle = async () => {
    try {
      if (httpStatus.running) {
        await invoke("stop_http")
        setHttpError(null)
      } else {
        const port = parseInt(httpPort) || 8080
        const boundPort = await invoke<number>("start_http", { port, lan: remoteLan })
        setHttpPort(String(boundPort))
        setHttpError(null)
      }
    } catch (e) {
      setHttpError(String(e))
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" className="mt-0.5" checked={remoteLan} onChange={(e) => setRemoteLan(e.target.checked)} disabled={oscStatus.running || httpStatus.running} />
        <span>
          Accept commands from other devices on this network
          <span className="block text-[0.625rem] text-muted-foreground">
            Anyone on the network can then send commands, unless a key is set or devices are paired below. Untick to accept only from this computer (127.0.0.1). Takes effect when a listener is started.
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" className="mt-0.5" checked={remoteAuthRequired || anyKey} disabled={anyKey} onChange={(e) => setRemoteAuthRequired(e.target.checked)} />
        <span>
          Require a key or a paired device
          <span className="block text-[0.625rem] text-muted-foreground">
            {anyKey ? "On while a key is set or a device is paired. Removing the last one keeps it on: nothing is accepted until you untick this." : remoteAuthRequired ? "On with no key and no device: every command is refused. Set a key or pair a device, or untick to accept anything." : "Off: anything on the network is accepted (as the app shipped)."}
          </span>
        </span>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span>Key the controller must send (optional)</span>
        <Input
          type="text"
          value={remoteSecret}
          onChange={(e) => setRemoteSecret(e.target.value)}
          placeholder="e.g. rhema-sunday-2026"
          className="h-7 max-w-xs text-xs"
          autoComplete="off"
        />
        <span className="text-[0.625rem] text-muted-foreground">
          HTTP: header <code>X-Rhema-Key: &lt;key&gt;</code>. OSC: the key as the first argument, e.g. <code>/rhema/next "&lt;key&gt;"</code>. Leave blank (and pair nothing) to accept anything, as before. Changes apply at once.
        </span>
      </label>
      <div className="flex flex-col gap-2 text-xs">
        <div className="flex items-center justify-between">
          <span>Paired devices</span>
          {showPairCode ? (
            <Button size="sm" variant="outline" className="text-xs" onClick={() => void cancelPairing()}>Cancel pairing</Button>
          ) : (
            <Button size="sm" variant="outline" className="text-xs" disabled={!httpStatus.running} title={httpStatus.running ? undefined : "Start the HTTP API first; devices pair over it"} onClick={() => void startPairing()}>Pair a device</Button>
          )}
        </div>
        {showPairCode && (
          <div className="rounded-md border border-border bg-muted/40 p-3">
            {pairQr && (
              <div className="mb-2 flex items-center gap-3">
                {pairQr.host ? <img src={pairQr.image} alt="Pairing code for a phone" className="size-32 rounded bg-white p-1" /> : null}
                <div className="flex min-w-0 flex-col gap-1 text-[0.625rem] text-muted-foreground">
                  <p>{pairQr.host ? <>Scan with the phone's camera (same Wi-Fi) and press Pair. Or open <code className="break-all">{pairQr.url.split("#")[0]}</code> and type the code.</> : "This computer's network address could not be found. Type it below (Wi-Fi settings show it) to get a code to scan."}</p>
                  <label className="flex items-center gap-1">
                    This computer's address
                    <Input
                      aria-label="This computer's address for the phone"
                      defaultValue={pairQr.host}
                      placeholder="192.168.1.20"
                      className="h-6 w-32 text-[0.625rem]"
                      onBlur={(e) => { const h = e.target.value.trim(); if (pairCode && httpStatus.port && /^[\w.:-]+$/.test(h) && h !== pairQr.host) void showPairQr(h, pairCode, httpStatus.port) }}
                    />
                  </label>
                  <span>Wrong address (VPN, cable and Wi-Fi on different networks)? Change it to the one the phone's Wi-Fi can reach.</span>
                </div>
              </div>
            )}
            <p className="text-[0.625rem] text-muted-foreground">On the device, within two minutes, send this code once:</p>
            <p className="my-1 font-mono text-2xl tracking-[0.3em]">{pairCode}</p>
            <p className="text-[0.625rem] text-muted-foreground">
              <code>POST http://&lt;this laptop&gt;:{httpStatus.port ?? httpPort}/api/v1/pair</code> with <code>{`{"code":"${pairCode}","name":"Tolu's phone"}`}</code>. The reply holds the device's token; it is shown once. Three wrong codes close the window.
            </p>
          </div>
        )}
        {remoteDevices.length === 0 ? (
          <p className="text-[0.625rem] text-muted-foreground">None yet. A paired device sends its own token instead of the shared key, can be revoked on its own, and starts as "Present only" (next, previous, show, hide, macros; not theme, opacity, confidence or the on-air switch).</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {remoteDevices.map((d) => (
              <li key={d.hash} className="flex items-center gap-2 px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate">{d.name}</span>
                <select
                  aria-label={`What ${d.name} may do`}
                  value={d.role ?? "configure"}
                  onChange={(e) => setRemoteDeviceRole(d.hash, e.target.value === "present" ? "present" : "configure")}
                  className="h-6 rounded border border-border bg-background px-1 text-[0.625rem]"
                >
                  <option value="present">Present only</option>
                  <option value="configure">Present and change settings</option>
                </select>
                <span className="shrink-0 text-[0.625rem] text-muted-foreground">paired {new Date(d.paired_at).toLocaleDateString()}</span>
                <Button size="sm" variant="ghost" className="text-xs text-destructive" aria-label={`Revoke ${d.name}`} onClick={() => revokeRemoteDevice(d.hash)}>Revoke</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ObsSettingsBlock />
      {/* OSC */}
      <div className="flex flex-col gap-3">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          OSC (Open Sound Control)
        </label>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 flex-1">
            <label className="text-xs text-muted-foreground">Port</label>
            <Input
              type="number"
              value={oscPort}
              onChange={(e) => setOscPort(e.target.value)}
              className="h-7 w-24 text-xs"
              disabled={oscStatus.running}
            />
          </div>
          <StatusDot running={oscStatus.running} />
          <Button
            size="sm"
            variant={oscStatus.running ? "destructive" : "default"}
            onClick={handleOscToggle}
            className="text-xs"
          >
            {oscStatus.running ? "Stop" : "Start"}
          </Button>
        </div>
        {oscError && (
          <p className="text-[0.625rem] text-red-500">{oscError}</p>
        )}
        {oscStatus.running && oscStatus.port && (
          <p className="text-[0.625rem] text-muted-foreground">
            Listening on UDP port {oscStatus.port}
          </p>
        )}
        <p className="text-[0.625rem] text-muted-foreground">
          Receives commands from hardware controllers (Stream Deck, TouchOSC, Companion)
          via OSC over UDP.
        </p>
      </div>

      {/* HTTP API */}
      <div className="flex flex-col gap-3">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          HTTP API
        </label>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 flex-1">
            <label className="text-xs text-muted-foreground">Port</label>
            <Input
              type="number"
              value={httpPort}
              onChange={(e) => setHttpPort(e.target.value)}
              className="h-7 w-24 text-xs"
              disabled={httpStatus.running}
            />
          </div>
          <StatusDot running={httpStatus.running} />
          <Button
            size="sm"
            variant={httpStatus.running ? "destructive" : "default"}
            onClick={handleHttpToggle}
            className="text-xs"
          >
            {httpStatus.running ? "Stop" : "Start"}
          </Button>
        </div>
        {httpError && (
          <p className="text-[0.625rem] text-red-500">{httpError}</p>
        )}
        {httpStatus.running && httpStatus.port && (
          <p className="text-[0.625rem] text-muted-foreground">
            Serving on http://localhost:{httpStatus.port}/api/v1/
          </p>
        )}
        <p className="text-[0.625rem] text-muted-foreground">
          REST API for status queries and control commands. Use with custom dashboards,
          automation scripts, or HTTP-capable controllers.
        </p>
      </div>

      {/* Firewall guidance */}
      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <p className="text-[0.625rem] font-medium text-muted-foreground mb-1">Firewall Note</p>
        <p className="text-[0.625rem] text-muted-foreground leading-relaxed">
          Your OS may block incoming connections. On macOS, allow Rhema through
          System Settings → Network → Firewall. On Windows, allow through
          Windows Security → Firewall → Allow an app.
        </p>
      </div>

      {/* Command Log */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Command Log
          </label>
          {commandLog.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 text-[0.5rem] px-1.5"
              onClick={() => setCommandLog([])}
            >
              Clear
            </Button>
          )}
        </div>
        <div className="h-32 overflow-y-auto rounded-lg border border-border bg-background p-2">
          {commandLog.length === 0 ? (
            <p className="text-[0.625rem] text-muted-foreground text-center mt-8">
              No commands received yet
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {commandLog.map((entry) => (
                <div key={entry.id} className="flex items-center gap-2 text-[0.625rem]">
                  <span className="text-muted-foreground tabular-nums shrink-0">
                    {entry.timestamp}
                  </span>
                  <Badge variant="outline" className="text-[0.5rem] h-3.5 px-1">
                    {entry.source}
                  </Badge>
                  <span className="text-foreground font-mono">{entry.command}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Section: Help                                                             */
/* -------------------------------------------------------------------------- */

function HelpSection() {
  const closeSettings = useSettingsDialogStore((s) => s.closeSettings)

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Resources to help you get the most out of Rhema.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <GraduationCapIcon className="size-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">Interactive Tutorial</p>
              <p className="text-xs text-muted-foreground">
                Step-by-step walkthrough of every feature
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              closeSettings()
              setTimeout(() => {
                useTutorialStore.getState().startTutorial()
              }, 300)
            }}
          >
            <GraduationCapIcon className="mr-1.5 size-3.5" />
            Restart
          </Button>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
              <KeyIcon className="size-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">Keyboard Shortcuts</p>
              <p className="text-xs text-muted-foreground">
                Arrow keys navigate the tutorial, Esc to dismiss
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusDot({ running }: { running: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className={`size-2 rounded-full ${
          running ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/30"
        }`}
      />
      <span className="text-[0.625rem] text-muted-foreground">
        {running ? "Listening" : "Stopped"}
      </span>
    </div>
  )
}

const sectionComponents: Record<NavSection, React.FC> = {
  audio: AudioSection,
  speech: SpeechSection,
  bible: BibleSection,
  display: DisplayModeSection,
  remote: RemoteControlSection,
  "api-keys": ApiKeysSection,
  diagnostics: DiagnosticsSection,
  help: HelpSection,
}

/*  Main dialog                                                               */
/* -------------------------------------------------------------------------- */

export function SettingsDialog() {
  const open = useSettingsDialogStore((s) => s.isOpen)
  const activeSection = useSettingsDialogStore((s) => s.activeSection)
  const setActiveSection = useSettingsDialogStore((s) => s.setActiveSection)
  const openSettingsFn = useSettingsDialogStore((s) => s.openSettings)
  const closeSettings = useSettingsDialogStore((s) => s.closeSettings)

  const ActiveContent = sectionComponents[activeSection]

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          openSettingsFn()
        } else {
          closeSettings()
        }
      }}
    >
      <DialogContent className="overflow-hidden p-0 md:max-h-[600px] md:max-w-[800px] lg:max-w-[900px]">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Configure audio, display mode, and API keys.
        </DialogDescription>
        <SidebarProvider className="items-start">
          <Sidebar collapsible="none" className="hidden md:flex">
            <div className="h-14 border-b border-border border-r px-4 flex items-center" >
              Settings
            </div>
            <SidebarContent className="border-r border-border">
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {navItems.map((item) => (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          isActive={item.id === activeSection}
                          onClick={() => setActiveSection(item.id)}
                        >
                          {item.icon}
                          <span>{item.name}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
          <main className="flex h-[580px] flex-1 flex-col overflow-hidden">
            <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border">
              <div className="flex items-center gap-2 px-4">
                {sectionTitles[activeSection]}
              </div>
            </header>
            <div className="flex flex-1 flex-col overflow-y-auto p-4">
              <ActiveContent />
            </div>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  )
}

/** OBS connection (obs-websocket v5, OBS → Tools → WebSocket Server Settings). Optional: nothing needs OBS to present. */
function ObsSettingsBlock() {
  const obs = useSettingsStore((s) => s.obs)
  const setObs = useSettingsStore((s) => s.setObs)
  const status = useObsStore((s) => s.status)
  const error = useObsStore((s) => s.error)
  // Edited locally and applied with "Save", so a half-typed address or password is never tried.
  const [draft, setDraft] = useState({ host: obs.host, port: String(obs.port), password: obs.password })
  const port = Number(draft.port)
  const portOk = Number.isInteger(port) && port > 0 && port < 65536
  const changed = draft.host !== obs.host || draft.port !== String(obs.port) || draft.password !== obs.password
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3 text-xs">
      <label className="flex items-center gap-2 font-medium">
        <input type="checkbox" checked={obs.enabled} onChange={(e) => setObs({ enabled: e.target.checked })} />
        Connect to OBS (recording status and marks)
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="OBS address" value={draft.host} onChange={(e) => setDraft({ ...draft, host: e.target.value })} placeholder="127.0.0.1" className="h-7 w-40 text-xs" />
        <Input aria-label="OBS port" inputMode="numeric" value={draft.port} onChange={(e) => setDraft({ ...draft, port: e.target.value.replace(/[^0-9]/g, "") })} placeholder="4455" className="h-7 w-24 text-xs" />
        <Input aria-label="OBS WebSocket password" type="password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} placeholder="password (if set in OBS)" className="h-7 w-48 text-xs" autoComplete="off" />
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!changed || !portOk || !draft.host.trim()} onClick={() => setObs({ host: draft.host.trim(), port, password: draft.password })}>Save</Button>
      </div>
      <p className="text-[0.625rem] text-muted-foreground">
        {obs.enabled ? (status === "connected" ? "Connected." : status === "connecting" ? "Connecting…" : `Not connected${error ? `: ${error}` : ""}. Retrying every 15 seconds.`) : "Off. In OBS: Tools → WebSocket Server Settings → Enable, then copy the port and password here."} The password stays in this computer's settings file. Use a staff-only network: the login answer travels unencrypted.
      </p>
    </div>
  )
}

/** Whether this computer agreed to send microphone audio to the cloud provider, with a way to take it back. */
function CloudConsentLine() {
  const at = useSettingsStore((s) => s.cloudSpeechConsentAt)
  if (!at) return <p className="text-[0.625rem] text-muted-foreground">Not agreed yet on this computer.</p>
  return (
    <p className="flex items-center gap-2 text-[0.625rem] text-muted-foreground">
      Agreed on {new Date(at).toLocaleDateString()}.
      <button
        type="button"
        className="underline"
        onClick={() => {
          useSettingsStore.getState().setCloudSpeechConsent(false)
          // Withdrawing stops a cloud session that is running now, not only the next one.
          if (useCloudConsentStore.getState().runningProvider === "deepgram") void transcriptionActions.stop()
        }}
      >
        Withdraw
      </button>
      (stops cloud listening now; asks again next time)
    </p>
  )
}
