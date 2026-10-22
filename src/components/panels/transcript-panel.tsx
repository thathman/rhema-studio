import { useCallback, useEffect, useRef, useState, type RefObject } from "react"
import { PanelHeader } from "@/components/ui/panel-header"
import { LevelMeter } from "@/components/ui/level-meter"
import { Button } from "@/components/ui/button"
import { ApiKeyPrompt } from "@/components/ui/api-key-prompt"
import { MicIcon, MicOffIcon } from "lucide-react"
import { useAudioStore, useTranscriptStore } from "@/stores"
import { useTranscription } from "@/hooks/use-transcription"
import { observeLongTasks } from "@/lib/latency-marks"
import { cn } from "@/lib/utils"

/**
 * Leaf component that subscribes to the audio level only. Isolated so the
 * high-frequency `audio_level` tick (many times per second during recording)
 * does NOT re-render the transcript list, connection dot, or button subtree.
 */
function AudioLevelMeter() {
  const rms = useAudioStore((s) => s.level.rms)
  return <LevelMeter level={rms} bars={6} />
}

/**
 * Leaf component that subscribes to `currentPartial`. Partials update per audio tick.
 */
function LivePartialLine({ scrollRef }: { scrollRef: RefObject<HTMLDivElement | null> }) {
  const currentPartial = useTranscriptStore((s) => s.currentPartial)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [currentPartial, scrollRef])

  if (!currentPartial) return null

  return (
    <p className="border-l-2 border-primary pl-2 text-base leading-relaxed text-foreground">
      {currentPartial}
      <span className="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-primary align-middle" />
    </p>
  )
}

export function TranscriptPanel() {
  const [showKeyPrompt, setShowKeyPrompt] = useState(false)
  const onMissingApiKey = useCallback(() => setShowKeyPrompt(true), [])
  const {
    segments,
    isTranscribing,
    connectionStatus,
    startTranscription,
    stopTranscription,
  } = useTranscription({ onMissingApiKey })
  const hasPartial = useTranscriptStore((s) => s.currentPartial.length > 0)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Latency debugging: surface main-thread stalls in the unified [LAT] log.
  useEffect(() => observeLongTasks(), [])

  // Auto-scroll on segment additions. Partial-driven scrolling lives in
  // LivePartialLine so the panel doesn't re-render per audio tick.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [segments])

  return (
    <div
      data-slot="transcript-panel"
      className="flex flex-col overflow-hidden rounded-lg border border-border bg-card"
    >
      <PanelHeader title="Transcript">
        <div className="flex items-center gap-2">
          {isTranscribing && (
            <span
              aria-hidden
              className={cn(
                "size-1.5 rounded-full",
                connectionStatus === "connected"
                  ? "bg-confidence-high"
                  : connectionStatus === "connecting"
                    ? "animate-pulse bg-confidence-mid"
                    : connectionStatus === "error"
                      ? "bg-confidence-low"
                      : "bg-muted-foreground/40"
              )}
              title={connectionStatus}
            />
          )}
          <AudioLevelMeter />
          {isTranscribing ? (
            <Button
              variant="outline"
              size="xs"
              className="ml-1 text-destructive hover:text-destructive"
              onClick={stopTranscription}
            >
              <MicOffIcon />
              Stop listening
            </Button>
          ) : (
            <Button variant="outline" size="xs" className="ml-1" onClick={startTranscription}>
              <MicIcon />
              Start listening
            </Button>
          )}
        </div>
      </PanelHeader>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-2 p-3">
          {/* Faded top gradient */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-linear-to-b from-card to-transparent" />

          {segments.length === 0 && !hasPartial && (
            <p className="text-sm text-muted-foreground">
              {isTranscribing ? "Listening. What the preacher says appears here." : "Start listening to follow the sermon as text."}
            </p>
          )}

          {/* Final segments — recent ones brighter, older ones fade */}
          {segments.map((seg, idx) => {
            const distFromEnd = segments.length - 1 - idx
            const opacity =
              distFromEnd === 0
                ? "text-foreground/80"
                : distFromEnd === 1
                  ? "text-foreground/60"
                  : distFromEnd <= 3
                    ? "text-foreground/40"
                    : "text-foreground/25"
            return (
              <p
                key={seg.id}
                className={`text-sm leading-relaxed transition-colors duration-300 ${opacity}`}
              >
                {seg.text}
              </p>
            )
          })}

          {/* Partial (in-progress) text rendered by leaf subscriber */}
          <LivePartialLine scrollRef={scrollRef} />
        </div>
      </div>

      <ApiKeyPrompt
        open={showKeyPrompt}
        onOpenChange={setShowKeyPrompt}
        service="Deepgram"
        description="Live transcription needs a Deepgram API key. Add it in settings so the app can start listening."
      />
    </div>
  )
}
