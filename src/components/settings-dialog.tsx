import { AboutNotices } from "@/components/about-notices"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { AssistantsSection } from "@/components/settings/assistants-section"
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
import { MonitorIcon, MoonIcon, PaletteIcon, SparklesIcon, SunIcon } from "lucide-react"
import { useTheme } from "@/components/theme-provider"
import { useShellStore } from "@/studio/shell-store"
import type { DeviceInfo } from "@/types/audio"

/* -------------------------------------------------------------------------- */
/*  Nav definition                                                            */
/* -------------------------------------------------------------------------- */

type NavSection =
  | "screens"
  | "appearance"
  | "audio"
  | "speech"
  | "bible"
  | "display"
  | "api-keys"
  | "remote"
  | "assistants"
  | "diagnostics"
  | "help"

const navItems: { name: string; id: NavSection; icon: React.ReactNode }[] = [
  { name: "Outputs", id: "screens", icon: <MonitorIcon strokeWidth={2} /> },
  { name: "Light or dark", id: "appearance", icon: <SunIcon strokeWidth={2} /> },
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
    name: "Heard verses",
    id: "display",
    icon: <TvIcon strokeWidth={2} />,
  },
  {
    name: "Remote Control",
    id: "remote",
    icon: <RadioIcon strokeWidth={2} />,
  },
  {
    name: "AI assistants",
    id: "assistants",
    icon: <SparklesIcon strokeWidth={2} />,
  },
  {
    name: "Cloud keys",
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
      <p className="text-[0.6875rem] text-muted-foreground">
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
  const listening = useTranscriptStore((s) => s.isTranscribing)

  return (
    <div className="flex flex-col gap-6">
      {listening && <ListeningNote />}
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
        <p className="text-[0.6875rem] text-muted-foreground">
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
        <p className="text-[0.6875rem] text-muted-foreground">
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

/** Device, gain and provider are taken when listening starts (FR-10): say so while it runs. */
function ListeningNote() {
  return (
    <p role="status" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      Rhema is listening now. Changes here apply when you stop and start listening again.
    </p>
  )
}

function SpeechSection() {
  const listeningNow = useTranscriptStore((s) => s.isTranscribing)
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
      {listeningNow && <ListeningNote />}
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
              <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
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
              <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
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
              <Badge variant="outline" className="text-[0.6875rem]">
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
          <p className="text-[0.6875rem] text-muted-foreground">
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
  // The same switch as Auto on the Live panel in Present → Production (FR-01: off until turned on).
  const autoLive = useBroadcastStore((s) => s.autoLive)
  const setAutoLive = useBroadcastStore((s) => s.setAutoLive)

  return (
    <div className="flex flex-col gap-6">
      {/* Mode selector */}
      <div className="flex flex-col gap-3">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Heard verses
        </label>

        <RadioGroup
          value={autoLive ? "auto" : "manual"}
          onValueChange={(v) => setAutoLive(v === "auto")}
          className="gap-3"
        >
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-data-[state=checked]:border-primary/50 has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:ring-1 has-data-[state=checked]:ring-primary/20 ${
              autoLive ? "hover:border-muted-foreground/25" : ""
            }`}
          >
            <RadioGroupItem value="manual" className="mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground">Wait for me (recommended)</span>
              <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
                A verse heard while listening goes to the preview and the detections list. It reaches the screen only when you press Show live.
              </p>
            </div>
          </label>

          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-data-[state=checked]:border-primary/50 has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:ring-1 has-data-[state=checked]:ring-primary/20 ${
              !autoLive ? "hover:border-muted-foreground/25" : ""
            }`}
          >
            <RadioGroupItem value="auto" className="mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground">Auto</span>
              <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
                While the output is on air, the most confident verse heard (at least 80% sure, or the level a remote control set) replaces what is on screen without Show live. Present shows "Auto-live on" while it is listening. Same as the Auto switch on the Live panel in Present → Production.
              </p>
            </div>
          </label>
        </RadioGroup>
      </div>
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
            <Badge variant="outline" className="text-[0.6875rem]">
              Key configured
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[0.6875rem] text-muted-foreground">
              Not set
            </Badge>
          )}
        </div>
        <p className="text-[0.6875rem] text-muted-foreground">
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
  assistants: "AI assistants (MCP)",
  screens: "Screens and NDI",
  appearance: "Appearance",
  audio: "Audio",
  speech: "Speech Recognition",
  bible: "Bible Translation",
  display: "Heard verses",
  remote: "Remote Control",
  "api-keys": "Cloud keys",
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
                <div className="px-2 py-1 text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">
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
                <div className="mt-1 px-2 py-1 text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">
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
        <p className="text-[0.6875rem] text-muted-foreground">
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
        <p className="text-[0.6875rem] text-muted-foreground">
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
  /** HTTP only: the https port for phone pages, when https is on. */
  tls_port?: number | null
}

interface CommandLogEntry {
  id: number
  timestamp: string
  source: "Remote"
  command: string
}

function RemoteControlSection() {
  // Saved, so the listeners start again the same way with the app.
  const saved = useSettingsStore((s) => s.remoteListeners)
  const setListeners = useSettingsStore((s) => s.setRemoteListeners)
  const [oscPort, setOscPort] = useState(String(saved.oscPort))
  const [httpPort, setHttpPort] = useState(String(saved.httpPort))
  // Applies to both listeners at their next start.
  const remoteLan = saved.lan
  const setRemoteLan = (lan: boolean) => setListeners({ lan })
  const remoteHttps = saved.https ?? false
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
  const showPairQr = async (host: string, code: string, port: number, tlsPort?: number | null) => {
    // With https on, the phone opens the secure page, so it can talk too.
    const url = tlsPort ? `https://${host}:${tlsPort}/remote#code=${code}` : `http://${host}:${port}/remote#code=${code}`
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
      if (status?.lan && status.port) await showPairQr(ip ?? "", code, status.port, status.tls_port)
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
    const poll = async () => {
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
    }
    // At once on opening, so running listeners never show as stopped.
    void poll()
    const interval = setInterval(() => void poll(), 2000)
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
            source: "Remote", // OSC or HTTP: the event does not say which
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
        setListeners({ osc: false })
        setOscError(null)
      } else {
        const port = parseInt(oscPort) || 8000
        const boundPort = await invoke<number>("start_osc", { port, lan: remoteLan })
        setOscPort(String(boundPort))
        setListeners({ osc: true, oscPort: boundPort })
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
        setListeners({ http: false })
        setHttpError(null)
      } else {
        const port = parseInt(httpPort) || 8080
        const boundPort = await invoke<number>("start_http", { port, lan: remoteLan, https: remoteHttps })
        setHttpPort(String(boundPort))
        setListeners({ http: true, httpPort: boundPort })
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
          <span className="block text-[0.6875rem] text-muted-foreground">
            Anyone on the network can then send commands, unless a key is set or devices are paired below. Untick to accept only from this computer (127.0.0.1). Takes effect when a listener is started.
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" className="mt-0.5" checked={remoteHttps} onChange={(e) => setListeners({ https: e.target.checked })} disabled={httpStatus.running} />
        <span>
          Secure page for phones (https)
          <span className="block text-[0.6875rem] text-muted-foreground">
            A phone can talk in the crew's talk channel only from a secure page. With this on, the phone page is also served over https on the next port ({(Number(httpPort) || 8080) + 1}), with a certificate this computer makes for itself. Each phone either accepts its browser's warning once, or installs this computer's certificate (the link appears below once the listener runs) to trust it. Nothing goes outside the church network. Takes effect when the HTTP listener is started.
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" className="mt-0.5" checked={remoteAuthRequired || anyKey} disabled={anyKey} onChange={(e) => setRemoteAuthRequired(e.target.checked)} />
        <span>
          Require a key or a paired device
          <span className="block text-[0.6875rem] text-muted-foreground">
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
        <span className="text-[0.6875rem] text-muted-foreground">
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
                <div className="flex min-w-0 flex-col gap-1 text-[0.6875rem] text-muted-foreground">
                  <p>{pairQr.host ? <>Scan with the phone's camera (same Wi-Fi) and press Pair. Or open <code className="break-all">{pairQr.url.split("#")[0]}</code> and type the code.</> : "This computer's network address could not be found. Type it below (Wi-Fi settings show it) to get a code to scan."}</p>
                  <label className="flex items-center gap-1">
                    This computer's address
                    <Input
                      aria-label="This computer's address for the phone"
                      defaultValue={pairQr.host}
                      placeholder="192.168.1.20"
                      className="h-6 w-32 text-[0.6875rem]"
                      onBlur={(e) => { const h = e.target.value.trim(); if (pairCode && httpStatus.port && /^[\w.:-]+$/.test(h) && h !== pairQr.host) void showPairQr(h, pairCode, httpStatus.port) }}
                    />
                  </label>
                  <span>Wrong address (VPN, cable and Wi-Fi on different networks)? Change it to the one the phone's Wi-Fi can reach.</span>
                </div>
              </div>
            )}
            <p className="text-[0.6875rem] text-muted-foreground">On the device, within two minutes, send this code once:</p>
            <p className="my-1 font-mono text-2xl tracking-[0.3em]">{pairCode}</p>
            <p className="text-[0.6875rem] text-muted-foreground">
              <code>POST http://&lt;this laptop&gt;:{httpStatus.port ?? httpPort}/api/v1/pair</code> with <code>{`{"code":"${pairCode}","name":"Tolu's phone"}`}</code>. The reply holds the device's token; it is shown once. Three wrong codes close the window.
            </p>
          </div>
        )}
        {remoteDevices.length === 0 ? (
          <p className="text-[0.6875rem] text-muted-foreground">None yet. A paired device sends its own token instead of the shared key, can be revoked on its own, and starts as "Present only" (next, previous, show, hide, macros; not theme, opacity, confidence or the on-air switch).</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {remoteDevices.map((d) => (
              <li key={d.hash} className="flex items-center gap-2 px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate">{d.name}</span>
                <select
                  aria-label={`What ${d.name} may do`}
                  value={d.role ?? "configure"}
                  onChange={(e) => setRemoteDeviceRole(d.hash, (["present", "timekeeper", "bible", "screens"] as const).find((r) => r === e.target.value) ?? "configure")}
                  className="h-6 rounded border border-border bg-background px-1 text-[0.6875rem]"
                >
                  <option value="timekeeper">Timekeeper (the event clock only)</option>
                  <option value="bible">Bible (activates and steps the Bible only)</option>
                  <option value="screens">Screens (congregation scenes only)</option>
                  <option value="present">Present only</option>
                  <option value="configure">Present and change settings</option>
                </select>
                <span className="shrink-0 text-[0.6875rem] text-muted-foreground">paired {new Date(d.paired_at).toLocaleDateString()}</span>
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
          <p className="text-[0.6875rem] text-red-500">{oscError}</p>
        )}
        {oscStatus.running && oscStatus.port && (
          <p className="text-[0.6875rem] text-muted-foreground">
            Listening on UDP port {oscStatus.port}
          </p>
        )}
        <p className="text-[0.6875rem] text-muted-foreground">
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
          <p className="text-[0.6875rem] text-red-500">{httpError}</p>
        )}
        {httpStatus.running && httpStatus.port && (
          <p className="text-[0.6875rem] text-muted-foreground">
            Serving on http://localhost:{httpStatus.port}/api/v1/
          </p>
        )}
        {httpStatus.running && httpStatus.tls_port && (
          <p className="text-[0.6875rem] text-muted-foreground">
            Secure phone page on port {httpStatus.tls_port} (https). To trust it on a phone instead of accepting the warning, open <code>http://&lt;this laptop&gt;:{httpStatus.port}/rhema-ca.pem</code> on the phone and install the certificate.
          </p>
        )}
        <p className="text-[0.6875rem] text-muted-foreground">
          REST API for status queries and control commands. Use with custom dashboards,
          automation scripts, or HTTP-capable controllers.
        </p>
      </div>

      {/* Firewall guidance */}
      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <p className="text-[0.6875rem] font-medium text-muted-foreground mb-1">Firewall Note</p>
        <p className="text-[0.6875rem] text-muted-foreground leading-relaxed">
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
              className="h-5 text-[0.6875rem] px-1.5"
              onClick={() => setCommandLog([])}
            >
              Clear
            </Button>
          )}
        </div>
        <div className="h-32 overflow-y-auto rounded-lg border border-border bg-background p-2">
          {commandLog.length === 0 ? (
            <p className="text-[0.6875rem] text-muted-foreground text-center mt-8">
              No commands received yet
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {commandLog.map((entry) => (
                <div key={entry.id} className="flex items-center gap-2 text-[0.6875rem]">
                  <span className="text-muted-foreground tabular-nums shrink-0">
                    {entry.timestamp}
                  </span>
                  <Badge variant="outline" className="text-[0.6875rem] h-4 px-1">
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

      <AboutNotices />
    </div>
  )
}

function StatusDot({ running }: { running: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className={`size-2 rounded-full ${
          running ? "bg-confidence-high animate-pulse" : "bg-muted-foreground/30"
        }`}
      />
      <span className="text-[0.6875rem] text-muted-foreground">
        {running ? "Listening" : "Stopped"}
      </span>
    </div>
  )
}

const sectionComponents: Record<NavSection, React.FC> = {
  assistants: AssistantsSection,
  screens: ScreensSection,
  appearance: AppearanceSection,
  audio: AudioSection,
  speech: SpeechSection,
  bible: BibleSection,
  display: DisplayModeSection,
  remote: RemoteControlSection,
  "api-keys": ApiKeysSection,
  diagnostics: DiagnosticsSection,
  help: HelpSection,
}

/* -------------------------------------------------------------------------- */
/*  Settings page                                                             */
/* -------------------------------------------------------------------------- */

/** The sections under the redesign's headings (ids unchanged, so openSettings("remote") still lands right). */
const GROUPS: Array<{ title: string; ids: NavSection[] }> = [
  { title: "Bible and languages", ids: ["bible"] },
  { title: "Screens and NDI", ids: ["screens"] },
  { title: "Live behaviour", ids: ["display"] },
  { title: "Microphone and speech", ids: ["audio", "speech", "api-keys"] },
  { title: "Studio connections", ids: ["remote", "assistants"] },
  { title: "Appearance", ids: ["appearance"] },
  { title: "Diagnostics and support", ids: ["diagnostics", "help"] },
]

/** Settings as a page: the sections down the side, the chosen one beside them. */
export function SettingsPage() {
  const activeSection = useSettingsDialogStore((s) => s.activeSection)
  const setActiveSection = useSettingsDialogStore((s) => s.setActiveSection)
  const ActiveContent = sectionComponents[activeSection]
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 px-8 pt-6 pb-4 max-[1200px]:px-5">
        <p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">Control, without complexity</p>
        <h1 className="mt-1 text-[1.625rem] leading-tight font-bold tracking-[-0.035em]">Settings, precisely organised.</h1>
        <p className="mt-1 text-xs text-muted-foreground">No buried controls: every setting has a reason and a clear home. Everything stays on this computer and applies at once.</p>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[255px_minmax(0,1fr)] gap-5 px-8 pb-6 max-[1200px]:grid-cols-[220px_minmax(0,1fr)] max-[1200px]:px-5">
        <nav aria-label="Settings sections" className="min-h-0 overflow-y-auto rounded-lg border border-border bg-card p-1.5">
          <p className="px-4 pt-3.5 pb-2 text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">Preferences</p>
          {GROUPS.map((g) => (
            <div key={g.title} className="mb-3">
              <p className="px-3 pt-1.5 pb-1 text-[0.625rem] font-semibold text-muted-foreground">{g.title}</p>
              {g.ids.map((id) => {
                const item = navItems.find((n) => n.id === id)!
                return (
                  <button
                    key={id}
                    type="button"
                    aria-current={id === activeSection ? "page" : undefined}
                    onClick={() => setActiveSection(id)}
                    className={`flex w-full items-center gap-2.5 rounded-md px-[13px] py-2.5 text-left text-xs font-bold outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-4 ${id === activeSection ? "bg-accent font-semibold text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                  >
                    {item.icon}
                    <span className="truncate">{item.name}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </nav>
        <section aria-label={sectionTitles[activeSection]} className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
          <h2 className="shrink-0 px-[30px] pt-[26px] pb-2 text-[1.5625rem] font-bold tracking-[-0.035em]">{sectionTitles[activeSection]}</h2>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[30px] pt-2 pb-[30px]">
            <ActiveContent />
          </div>
        </section>
      </div>
    </div>
  )
}

/** Screens and NDI: where outputs are set up and which look each shows. */
function ScreensSection() {
  return (
    <div className="flex max-w-xl flex-col gap-4 text-sm">
      <p className="text-muted-foreground">Projectors, stage screens, signage windows and NDI streams are outputs. Each one shows the congregation, stage or signage view, in its own languages and look.</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => useShellStore.getState().openOutputs()}><MonitorIcon /> Open outputs</Button>
        <Button variant="outline" onClick={() => useShellStore.getState().openDesign("used-on")}><PaletteIcon /> Where each look is used (Design)</Button>
      </div>
    </div>
  )
}

/** Appearance: light or dark for planning (Present is always dark). */
function AppearanceSection() {
  const { theme, setTheme } = useTheme()
  return (
    <div className="flex max-w-xl flex-col gap-3 text-sm">
      <p className="text-muted-foreground">How Rhema looks while you plan. The live console in Present is always dark, so it stays calm in a dim room.</p>
      <div role="radiogroup" aria-label="Appearance" className="flex gap-2">
        {(["light", "dark"] as const).map((t) => (
          <Button key={t} role="radio" aria-checked={theme === t} variant={theme === t ? "default" : "outline"} onClick={() => setTheme(t)}>{t === "light" ? <SunIcon /> : <MoonIcon />} {t === "light" ? "Light" : "Dark"}</Button>
        ))}
      </div>
    </div>
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
  // The saved password arriving later (keychain read again) fills an untouched box, so Save never blanks it.
  const savedPassword = useRef(obs.password)
  useEffect(() => {
    if (obs.password !== savedPassword.current) {
      const before = savedPassword.current
      setDraft((d) => (d.password === before ? { ...d, password: obs.password } : d))
      savedPassword.current = obs.password
    }
  }, [obs.password])
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
      <p className="text-[0.6875rem] text-muted-foreground">
        {obs.enabled ? (status === "connected" ? "Connected." : status === "connecting" ? "Connecting…" : `Not connected${error ? `: ${error}` : ""}. Retrying every 15 seconds.`) : "Off. In OBS: Tools → WebSocket Server Settings → Enable, then copy the port and password here."} The password is kept in the system keychain (or this computer's settings file where there is none). Use a staff-only network: the login answer travels unencrypted.
      </p>
    </div>
  )
}

/** Whether this computer agreed to send microphone audio to the cloud provider, with a way to take it back. */
function CloudConsentLine() {
  const at = useSettingsStore((s) => s.cloudSpeechConsentAt)
  if (!at) return <p className="text-[0.6875rem] text-muted-foreground">Not agreed yet on this computer.</p>
  return (
    <p className="flex items-center gap-2 text-[0.6875rem] text-muted-foreground">
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
