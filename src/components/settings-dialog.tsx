import { AboutNotices } from "@/components/about-notices"
import { CAPACITY_KINDS, NDI_60_MIN_CORES, NDI_60_MIN_MEMORY_GB, defaultLimits, physicalCores, suits60fps, useMachineInfo } from "@/lib/capacity"
import { autoModeOf, useBroadcastStore, type AutoMode } from "@/stores/broadcast-store"
import { AssistantsSection } from "@/components/settings/assistants-section"
import { ObsSettingsBlock } from "@/components/settings/obs-settings-block"
import { RemoteAuthSetting } from "@/components/settings/remote-auth-setting"
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
import { TalkDevices, TalkRulesSettings } from "@/studio/talk"
import { useAudioTest } from "@/hooks/use-audio-test"
import { useBibleStore, useSettingsStore } from "@/stores"
import { useTranscriptStore } from "@/stores/transcript-store"
import { retentionWords } from "@/lib/journal-transcript"
import { TRANSCRIPT_RETENTION_DAYS } from "@/stores/settings-store"
import { useTutorialStore } from "@/stores/tutorial-store"
import { useSettingsDialogStore, type SettingsSection } from "@/lib/settings-dialog"
import { markSearchHits, searchElsewhere, searchSettings, searchWords, type ElsewhereId } from "@/lib/settings-search"
import { openConnectionsHub } from "@/studio/connections/navigation"
import { REMOTE_EVENTS } from "@/lib/remote-events"
import { ArrowUpRightIcon, EyeIcon, EyeOffIcon, MonitorIcon, PaletteIcon, SearchIcon, SparklesIcon } from "lucide-react"
import { useShellStore } from "@/studio/shell-store"
import type { DeviceInfo } from "@/types/audio"
import { certificateWords } from "@/lib/host-certificate"

/* -------------------------------------------------------------------------- */
/*  Nav definition                                                            */
/* -------------------------------------------------------------------------- */

type NavSection = SettingsSection

const navItems: { name: string; id: NavSection; icon: React.ReactNode }[] = [
  { name: "Outputs", id: "screens", icon: <MonitorIcon strokeWidth={2} /> },
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
      <p className="text-xs text-muted-foreground">
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
        <p className="text-xs text-muted-foreground">
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
        <p className="text-xs text-muted-foreground">
          Amplifies the incoming audio signal before transcription. 50% is unity
          gain.
        </p>
      </div>

      {/* The talk channel's headset (Rhema Comms): separate from the listening microphone above. */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Talk headset
        </label>
        <TalkDevices />
        <p className="text-xs text-muted-foreground">
          The microphone you talk to the crew with and where you hear them, on this computer only. It never feeds listening, the outputs, OBS or the sound player.
        </p>
      </div>

      {/* The church's talk channels (Rhema Comms): who may use each, and how quiet priority makes the others. */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Talk channels
        </label>
        <TalkRulesSettings />
        <p className="text-xs text-muted-foreground">
          Set on the main desk for every joined desk and phone. Everyone is always in All crew; a role left out neither hears nor talks on that channel.
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
      Rhema Studio is listening now. Changes here apply when you stop and start listening again.
    </p>
  )
}

function SpeechSection() {
  const listeningNow = useTranscriptStore((s) => s.isTranscribing)
  const {
    sttProvider,
    setSttProvider,
    speechLanguage,
    setSpeechLanguage,
    deepgramApiKey,
    setDeepgramApiKey,
    openaiApiKey,
    setOpenaiApiKey,
  } = useSettingsStore()

  const [keyValue, setKeyValue] = useState(deepgramApiKey ?? "")
  const [saved, setSaved] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [openaiKeyValue, setOpenaiKeyValue] = useState(openaiApiKey ?? "")
  const [openaiSaved, setOpenaiSaved] = useState(false)
  const [showOpenAiKey, setShowOpenAiKey] = useState(false)

  const handleSaveKey = () => {
    setDeepgramApiKey(keyValue || null)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleSaveOpenAiKey = () => {
    setOpenaiApiKey(openaiKeyValue || null)
    setOpenaiSaved(true)
    setTimeout(() => setOpenaiSaved(false), 2000)
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
          onValueChange={(v) => setSttProvider(v as "deepgram" | "whisper" | "openai")}
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
              <p className="text-xs leading-relaxed text-muted-foreground">
                Uses Deepgram Nova-3 for real-time streaming transcription.
                Requires an API key and internet connection. Best accuracy with
                keyword boosting for Bible terms. While listening, the microphone
                sound is sent to Deepgram (USA); consent is requested separately for each cloud provider.
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
              <p className="text-xs leading-relaxed text-muted-foreground">
                Runs Whisper large-v3-turbo locally on your device. Fully
                offline, no API key needed. Audio never leaves your machine.
              </p>
            </div>
          </label>

          {/* OpenAI transcription (cloud) */}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-data-[state=checked]:border-primary/50 has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:ring-1 has-data-[state=checked]:ring-primary/20 ${
              sttProvider !== "openai" ? "hover:border-muted-foreground/25" : ""
            }`}
          >
            <RadioGroupItem value="openai" className="mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground">Cloud (OpenAI)</span>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Sends spoken audio segments to OpenAI&apos;s transcription API and returns a result after each segment instead of live interim words. Yorùbá is left to automatic language detection.
              </p>
              <CloudConsentLine provider="openai" />
            </div>
          </label>
        </RadioGroup>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="speech-language" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Speech language
        </label>
        <Select value={speechLanguage} onValueChange={(v) => setSpeechLanguage(v === "yo" ? "yo" : "en")}>
          <SelectTrigger id="speech-language" aria-label="Speech language" className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="yo">Yorùbá</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Select the spoken language. Deepgram does not support Yorùbá, so selecting it switches Deepgram to local Whisper; OpenAI transcription remains available.
        </p>
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
              type={showKey ? "text" : "password"}
              aria-label="Deepgram API key"
              autoComplete="off"
              placeholder="Enter your Deepgram API key..."
              value={keyValue}
              onChange={(e) => setKeyValue(e.target.value)}
              className="flex-1 text-xs"
            />
            <Button size="sm" variant="outline" aria-pressed={showKey} aria-label={showKey ? "Hide the key" : "Show the key"} title={showKey ? "Hide the key" : "Show the key"} onClick={() => setShowKey(!showKey)}>
              {showKey ? <EyeOffIcon className="size-3" /> : <EyeIcon className="size-3" />}
            </Button>
            {deepgramApiKey && (
              <Button size="sm" variant="outline" onClick={() => { setDeepgramApiKey(null); setKeyValue(""); setShowKey(false) }}>
                Clear
              </Button>
            )}
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
          <p className="text-xs text-muted-foreground">
            Required for live transcription. To replace the key, type the new one and Save. It is kept in the system keychain where there is one. Get a key at{" "}
            <span className="text-primary-text">deepgram.com</span>
          </p>
        </div>
      )}
      {sttProvider === "openai" && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <label htmlFor="openai-api-key" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              OpenAI API key
            </label>
            {openaiApiKey && <Badge variant="outline" className="text-[0.6875rem]">Key configured</Badge>}
          </div>
          <div className="flex gap-2">
            <Input
              id="openai-api-key"
              type={showOpenAiKey ? "text" : "password"}
              aria-label="OpenAI API key"
              autoComplete="off"
              placeholder="Enter your OpenAI API key..."
              value={openaiKeyValue}
              onChange={(e) => setOpenaiKeyValue(e.target.value)}
              className="flex-1 text-xs"
            />
            <Button size="sm" variant="outline" aria-pressed={showOpenAiKey} aria-label={showOpenAiKey ? "Hide the key" : "Show the key"} title={showOpenAiKey ? "Hide the key" : "Show the key"} onClick={() => setShowOpenAiKey(!showOpenAiKey)}>
              {showOpenAiKey ? <EyeOffIcon className="size-3" /> : <EyeIcon className="size-3" />}
            </Button>
            {openaiApiKey && (
              <Button size="sm" variant="outline" onClick={() => { setOpenaiApiKey(null); setOpenaiKeyValue(""); setShowOpenAiKey(false) }}>
                Clear
              </Button>
            )}
            <Button size="sm" onClick={handleSaveOpenAiKey}>
              {openaiSaved ? <><CheckIcon className="size-3" />Saved</> : "Save"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Required for OpenAI transcription. The key is kept in the system keychain where available; otherwise it remains in local app settings. It is excluded from settings backups.
          </p>
        </div>
      )}
      <TranscriptRetention />
    </div>
  )
}

/** How long a transcript kept with a service log stays (#246 C17): the church's choice, applied to every kept log. */
function TranscriptRetention() {
  const days = useSettingsStore((s) => s.transcriptRetentionDays)
  const setDays = useSettingsStore((s) => s.setTranscriptRetentionDays)
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="transcript-retention" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Transcripts in kept logs
      </label>
      <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
        <SelectTrigger id="transcript-retention" aria-label="Keep transcripts in kept logs" className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TRANSCRIPT_RETENTION_DAYS.map((d) => (
            <SelectItem key={d} value={String(d)}>Keep {retentionWords(d)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        What was said goes into a service log only when you tick it for that log. Older transcripts are taken out of their logs (the log stays) when Rhema starts and when you change this. Current builds log transcript lengths only; diagnostics from earlier builds may contain short fragments, so review them before sharing.
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Section: Display Mode                                                     */
/* -------------------------------------------------------------------------- */

function DisplayModeSection() {
  // The same switch as Auto on Present's Program panel (FR-01: off until turned on).
  const mode = useBroadcastStore(autoModeOf)
  const setAutoMode = useBroadcastStore((s) => s.setAutoMode)

  return (
    <div className="flex flex-col gap-6">
      {/* Mode selector */}
      <div className="flex flex-col gap-3">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Heard verses
        </label>

        <RadioGroup
          value={mode}
          onValueChange={(v) => setAutoMode(v as AutoMode)}
          className="gap-3"
        >
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-data-[state=checked]:border-primary/50 has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:ring-1 has-data-[state=checked]:ring-primary/20 ${
              mode !== "manual" ? "hover:border-muted-foreground/25" : ""
            }`}
          >
            <RadioGroupItem value="manual" className="mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground">Wait for me (recommended)</span>
              <p className="text-xs leading-relaxed text-muted-foreground">
                A verse heard while listening goes to the preview and the detections list. It reaches the screen only when you press Take live.
              </p>
            </div>
          </label>

          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-data-[state=checked]:border-primary/50 has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:ring-1 has-data-[state=checked]:ring-primary/20 ${
              mode !== "bible" ? "hover:border-muted-foreground/25" : ""
            }`}
          >
            <RadioGroupItem value="bible" className="mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground">Bible feeds only</span>
              <p className="text-xs leading-relaxed text-muted-foreground">
                The most confident verse heard goes to the feeds that follow Bible (an NDI or browser Bible feed for OBS, a scene's Bible box) by itself, and waits in the preview. The projector and other main screens never change without Take live.
              </p>
            </div>
          </label>

          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-data-[state=checked]:border-primary/50 has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:ring-1 has-data-[state=checked]:ring-primary/20 ${
              mode !== "auto" ? "hover:border-muted-foreground/25" : ""
            }`}
          >
            <RadioGroupItem value="auto" className="mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-foreground">Auto</span>
              <p className="text-xs leading-relaxed text-muted-foreground">
                While the output is on air, the most confident verse heard (at least 80% sure, or the level a remote control set) replaces what is on screen without Take live. Present shows "Auto-live on" while it is listening. Same as Auto on the Program panel.
              </p>
            </div>
          </label>
        </RadioGroup>
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
  audio: "Audio",
  speech: "Speech Recognition",
  bible: "Bible Translation",
  display: "Heard verses",
  remote: "Remote Control",
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
        <p className="text-xs text-muted-foreground">
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
        <p className="text-xs text-muted-foreground">
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
  /** HTTP only: this computer's certificate (its local CA's fingerprint) while https runs, as Rhema Studio Companion shows it (#209). */
  tls_certificate?: string | null
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
  const remoteAuthRequired = useSettingsStore((s) => s.remoteAuthRequired)
  const setRemoteAuthRequired = useSettingsStore((s) => s.setRemoteAuthRequired)
  const anyKey = remoteSecret.trim().length > 0 || remoteDevices.length > 0

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
          <span className="block text-xs text-muted-foreground">
            Other devices still need a key or pairing below while "Require a key or a paired device" is on (the setting on new installs). Web pages open in a browser on the network can never send commands. Untick to accept only from this computer (127.0.0.1). Takes effect when a listener is started.
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" className="mt-0.5" checked={remoteHttps} onChange={(e) => setListeners({ https: e.target.checked })} disabled={httpStatus.running} />
        <span>
          Secure page for phones (https)
          <span className="block text-xs text-muted-foreground">
            A phone can talk in the crew's talk channel only from a secure page. With this on, the phone page is also served over https on the next port ({(Number(httpPort) || 8080) + 1}), with a certificate this computer makes for itself. Each phone either accepts its browser's warning once, or installs this computer's certificate (the link appears below once the listener runs) to trust it. Nothing goes outside the church network. Takes effect when the HTTP listener is started.
          </span>
          {httpStatus.running && httpStatus.tls_certificate && (
            <span className="mt-1 block">
              This computer's certificate <code className="rounded bg-muted px-1.5 py-0.5 font-mono tracking-wide">{certificateWords(httpStatus.tls_certificate)}</code>
              <span className="block text-muted-foreground">Rhema Studio Companion on an OBS computer shows the same before it pairs. If it shows another, do not pair it.</span>
            </span>
          )}
        </span>
      </label>
      <RemoteAuthSetting required={remoteAuthRequired} locked={anyKey} onRequiredChange={setRemoteAuthRequired} />
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
        <span className="text-xs text-muted-foreground">
          HTTP: header <code>X-Rhema-Key: &lt;key&gt;</code>. OSC: the key as the first argument, e.g. <code>/rhema/next "&lt;key&gt;"</code>. Leave blank (and pair nothing) to accept anything, as before. Changes apply at once.
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3 text-xs">
        <div className="min-w-0 flex-1"><p className="font-semibold">Paired device access</p><p className="text-muted-foreground">Manage roles, pause control or revoke a device in Permissions. Pair new devices from Connections.</p></div>
        <Button size="sm" variant="outline" onClick={() => { useSettingsDialogStore.getState().closeSettings(); useShellStore.getState().goTo("permissions") }}>Manage access</Button>
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
          <p className="text-xs text-red-500">{oscError}</p>
        )}
        {oscStatus.running && oscStatus.port && (
          <p className="text-xs text-muted-foreground">
            Listening on UDP port {oscStatus.port}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
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
          <p className="text-xs text-red-500">{httpError}</p>
        )}
        {httpStatus.running && httpStatus.port && (
          <p className="text-xs text-muted-foreground">
            Serving on http://localhost:{httpStatus.port}/api/v1/
          </p>
        )}
        {httpStatus.running && httpStatus.tls_port && (
          <p className="text-xs text-muted-foreground">
            Secure phone page on port {httpStatus.tls_port} (https). To trust it on a phone instead of accepting the warning, open <code>http://&lt;this laptop&gt;:{httpStatus.port}/rhema-ca.pem</code> on the phone and install the certificate.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          REST API for status queries and control commands. Use with custom dashboards,
          automation scripts, or HTTP-capable controllers.
        </p>
      </div>

      {/* Firewall guidance */}
      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <p className="text-xs font-medium text-muted-foreground mb-1">Firewall Note</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Your OS may block incoming connections. On macOS, allow Rhema Studio (Rhema.app) through
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
            <p className="text-xs text-muted-foreground text-center mt-8">
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
          Resources to help you get the most out of Rhema Studio.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <GraduationCapIcon className="size-4 text-primary-text" />
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
  audio: AudioSection,
  speech: SpeechSection,
  bible: BibleSection,
  display: DisplayModeSection,
  remote: RemoteControlSection,
  diagnostics: DiagnosticsSection,
  help: HelpSection,
}

/* -------------------------------------------------------------------------- */
/*  Settings page                                                             */
/* -------------------------------------------------------------------------- */

/** The sections under five headings (ids unchanged, so openSettings("remote") still lands right). */
const GROUPS: Array<{ title: string; ids: NavSection[] }> = [
  { title: "Bible and languages", ids: ["bible"] },
  { title: "Display and output", ids: ["screens", "display"] },
  { title: "Microphone and speech", ids: ["audio", "speech"] },
  { title: "Connections", ids: ["remote", "assistants"] },
  { title: "Data and diagnostics", ids: ["diagnostics", "help"] },
]

const SEARCHABLE = navItems.map((n) => ({ id: n.id, name: n.name, title: sectionTitles[n.id] }))

/** Where a search hit outside Settings takes you. */
const ELSEWHERE: Record<ElsewhereId, () => void> = {
  church: () => useShellStore.getState().openDesign("brand"),
  appearance: () => useShellStore.getState().openDeskMenu(),
  cameras: openConnectionsHub,
  hosting: openConnectionsHub,
  permissions: () => { useSettingsDialogStore.getState().closeSettings(); useShellStore.getState().goTo("permissions") },
  "service-defaults": () => useShellStore.getState().goTo("team"),
  backups: () => useShellStore.getState().goTo("archive"),
}

/** Settings as a page: a search and the sections down the side, the chosen one beside them. */
export function SettingsPage() {
  const activeSection = useSettingsDialogStore((s) => s.activeSection)
  const setActiveSection = useSettingsDialogStore((s) => s.setActiveSection)
  const ActiveContent = sectionComponents[activeSection]
  const [query, setQuery] = useState("")
  const hits = searchSettings(query, SEARCHABLE)
  const elsewhere = searchElsewhere(query)
  const found = new Map(hits.map((h) => [h.id, h.labels]))
  const groups = GROUPS.map((g) => ({ ...g, ids: g.ids.filter((id) => found.has(id)) })).filter((g) => g.ids.length > 0)
  const searching = query.trim() !== ""
  const content = useRef<HTMLDivElement>(null)

  // Marks the labels in the open section that hold the search, and keeps marking as it loads (devices, translations).
  useEffect(() => {
    const box = content.current
    if (!box) return
    const words = searchWords(query)
    markSearchHits(box, words)
    if (words.length === 0) return
    const watch = new MutationObserver(() => markSearchHits(box, words))
    watch.observe(box, { childList: true, subtree: true, characterData: true })
    return () => watch.disconnect()
  }, [query, activeSection])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 px-8 pt-6 pb-4 max-[1200px]:px-5">
        <p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">Control, without complexity</p>
        <h1 className="mt-1 text-[1.625rem] leading-tight font-bold tracking-[-0.035em]">Settings, precisely organised.</h1>
        <p className="mt-1 text-xs text-muted-foreground">No buried controls: every setting has a reason and a clear home. Everything stays on this computer and applies at once.</p>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[255px_minmax(0,1fr)] gap-5 px-8 pb-6 max-[1200px]:grid-cols-[220px_minmax(0,1fr)] max-[1200px]:px-5">
        <nav aria-label="Settings sections" className="min-h-0 overflow-y-auto rounded-lg border border-border bg-card p-1.5">
          <div role="search" className="relative px-1.5 pt-1.5 pb-1">
            <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Search settings"
              aria-describedby="settings-search-hint"
              placeholder="Search settings"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (hits[0] || elsewhere[0])) {
                  e.preventDefault()
                  if (hits[0]) setActiveSection(hits[0].id)
                  else ELSEWHERE[elsewhere[0].id]()
                } else if (e.key === "Escape" && query) {
                  e.preventDefault()
                  e.stopPropagation()
                  setQuery("")
                }
              }}
              className="h-9 pl-8 text-xs"
            />
            <span id="settings-search-hint" className="sr-only">Enter opens the first match. Escape clears the search.</span>
          </div>
          <p role="status" className={searching ? "px-3 pt-1 pb-2 text-xs text-muted-foreground" : "sr-only"}>
            {!searching ? "" : hits.length === 0 && elsewhere.length === 0 ? "Nothing in Settings matches. Light and dark are under Appearance in the Desk menu, at the foot of the sidebar." : hits.length === 0 ? "Not in Settings: it has its own page, below. Enter opens the first." : `${hits.length} ${hits.length === 1 ? "section matches" : "sections match"}${elsewhere.length ? `, and ${elsewhere.length} elsewhere in Rhema` : ""}. Enter opens the first.`}
          </p>
          {!searching && <p className="px-4 pt-2.5 pb-2 text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">Preferences</p>}
          {groups.map((g) => (
            <div key={g.title} className="mb-3">
              <p className="px-3 pt-1.5 pb-1 text-[0.6875rem] font-semibold text-muted-foreground">{g.title}</p>
              {g.ids.map((id) => {
                const item = navItems.find((n) => n.id === id)!
                const labels = found.get(id) ?? []
                return (
                  <button
                    key={id}
                    type="button"
                    aria-current={id === activeSection ? "page" : undefined}
                    onClick={() => setActiveSection(id)}
                    className={`flex w-full items-center gap-2.5 rounded-md px-[13px] py-2.5 text-left text-xs font-bold outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-4 ${id === activeSection ? "bg-accent font-semibold text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                  >
                    {item.icon}
                    <span className="min-w-0">
                      <span className="block truncate">{item.name}</span>
                      {labels.length > 0 && <span className="block truncate text-[0.6875rem] font-normal">{labels.slice(0, 2).join(" · ")}</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
          {elsewhere.length > 0 && (
            // What has its own page elsewhere: a row that goes there (Settings keeps no copy of it).
            <div role="group" aria-label="Elsewhere in Rhema Studio" className="mb-3">
              <p className="px-3 pt-1.5 pb-1 text-[0.6875rem] font-semibold text-muted-foreground">Elsewhere in Rhema Studio</p>
              {elsewhere.map((e) => (
                <button key={e.id} type="button" onClick={ELSEWHERE[e.id]} className="flex w-full items-center gap-2.5 rounded-md px-[13px] py-2.5 text-left text-xs font-bold text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-4">
                  <ArrowUpRightIcon aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate">{e.name}</span>
                    <span className="block truncate text-[0.6875rem] font-normal">{e.where}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </nav>
        <section aria-label={sectionTitles[activeSection]} className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
          <h2 className="shrink-0 px-[30px] pt-[26px] pb-2 text-[1.5625rem] font-bold tracking-[-0.035em]">{sectionTitles[activeSection]}</h2>
          <div ref={content} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[30px] pt-2 pb-[30px] [&_[data-search-hit]]:rounded-sm [&_[data-search-hit]]:bg-accent [&_[data-search-hit]]:text-accent-foreground [&_[data-search-hit]]:shadow-[0_0_0_3px_var(--accent)]">
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
      <CapacityLimitsBlock />
    </div>
  )
}

/**
 * How much this computer runs before Rhema warns (#243 G13). Each limit is worked out from the
 * computer unless set here; going past one only warns, and 60 fps NDI on a smaller computer asks.
 */
function CapacityLimitsBlock() {
  const machine = useMachineInfo()
  const overrides = useSettingsStore((s) => s.capacityLimits)
  const setLimit = useSettingsStore((s) => s.setCapacityLimit)
  const auto = defaultLimits(machine)
  return (
    <section aria-label="How much this computer runs" className="flex flex-col gap-2 rounded-md border border-border p-3 text-xs">
      <h3 className="text-sm font-semibold">How much this computer runs</h3>
      <p className="text-muted-foreground">
        Rhema Studio warns before going past these (&ldquo;this computer may drop frames&rdquo;) but never stops you. {machine.known ? `Worked out from this computer: ${physicalCores(machine)} cores, ${Math.round(machine.memoryTotalMb / 1024)} GB.` : ""} Leave a box empty to use that figure.
      </p>
      {CAPACITY_KINDS.map(({ kind, label, hint }) => (
        <label key={kind} className="flex items-center gap-2">
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{label}</span>
            <span className="block text-muted-foreground">{hint}</span>
          </span>
          <Input
            aria-label={label}
            inputMode="numeric"
            value={overrides[kind] ?? ""}
            placeholder={String(auto[kind])}
            onChange={(e) => {
              const n = Number(e.target.value.replace(/[^0-9]/g, ""))
              setLimit(kind, e.target.value.trim() === "" || !n ? null : Math.min(64, n))
            }}
            className="h-7 w-16 text-xs"
          />
        </label>
      ))}
      <p className="text-muted-foreground">
        60 fps NDI: {suits60fps(machine) ? "suits this computer." : `this computer is below what it needs (${NDI_60_MIN_CORES} cores and ${NDI_60_MIN_MEMORY_GB} GB), so Rhema Studio asks before starting a sender at 60 fps.`}
      </p>
    </section>
  )
}

/** Whether this computer agreed to send microphone audio to the cloud provider, with a way to take it back. */
function CloudConsentLine({ provider = "deepgram" }: { provider?: "deepgram" | "openai" }) {
  const at = useSettingsStore((s) => s.cloudSpeechConsents[provider] ?? (provider === "deepgram" ? s.cloudSpeechConsentAt : ""))
  if (!at) return <p className="text-xs text-muted-foreground">Not agreed yet on this computer.</p>
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      Agreed on {new Date(at).toLocaleDateString()}.
      <button
        type="button"
        className="underline"
        onClick={() => {
          useSettingsStore.getState().setCloudSpeechConsent(provider, false)
          // Withdrawing stops a cloud session that is running now, not only the next one.
          if (useCloudConsentStore.getState().runningProvider === provider) void transcriptionActions.stop()
        }}
      >
        Withdraw
      </button>
      (stops cloud listening now; asks again next time)
    </p>
  )
}
