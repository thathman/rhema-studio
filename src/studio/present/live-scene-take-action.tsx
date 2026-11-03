import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { LayersIcon, RotateCcwIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { readSceneTakeRevisions, sceneTakeDrawn, takeSceneOnOutput, type SceneTakeRevisions } from "@/lib/scene-take"
import { sceneTakeApprovalBlockReason } from "@/studio/present/scene-take-policy"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useServiceStore } from "@/stores/service-store"
import { useSettingsStore } from "@/stores/settings-store"

export interface SceneTakeSelection {
  outputId: string
  outputName: string
  sceneId: string
  sceneName: string
  sceneUpdatedAt: number
  revisionLabel: string
  disabledReason: string | null
  details: string | null
}

type Phase = "idle" | "checking" | "ready" | "taking" | "confirmed" | "waiting" | "no-receiver" | "sent" | "unknown" | "stale" | "refused" | "blocked" | "rehearsed"
interface ViewState {
  key: string
  phase: Phase
  seen?: SceneTakeRevisions
  message?: string
  canReview?: boolean
}

const pause = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

/** The sole main-Live scene Take, attached to the selected output's actual Program panel. */
export function LiveSceneTakeAction({ selection }: {
  selection: SceneTakeSelection | null
}) {
  const rehearsal = useBroadcastStore((s) => s.rehearsal)
  const service = useServiceStore((s) => s.current)
  const requireApproval = useSettingsStore((s) => s.requireApproval)
  const approvalBlock = sceneTakeApprovalBlockReason(rehearsal, service, requireApproval)
  const serviceContext = `${service?.id ?? "no-service"}\u0000${service?.approved_revision ?? "unapproved"}`
  const key = selection ? `${selection.outputId}\u0000${selection.sceneId}\u0000${selection.sceneUpdatedAt}\u0000${rehearsal ? "rehearsal" : "live"}\u0000${serviceContext}` : ""
  const outputId = selection?.outputId
  const sceneId = selection?.sceneId
  const revisionLabel = selection?.revisionLabel
  const outputName = selection?.outputName
  const [view, setView] = useState<ViewState>({ key: "", phase: "idle" })
  const operation = useRef(0)
  const currentKey = useRef("")
  const blockRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    // Invalidate an earlier host check before passive effects or event handlers can consume it.
    operation.current += 1
    currentKey.current = key
    blockRef.current = approvalBlock
  }, [key, approvalBlock])

  useEffect(() => {
    if (!outputId || !sceneId || approvalBlock) return
    if (rehearsal) return
    const id = ++operation.current
    void readSceneTakeRevisions(outputId, sceneId).then((result) => {
      if (operation.current !== id || currentKey.current !== key || blockRef.current) return
      setView(result.ok
        ? { key, phase: "ready", seen: result.seen, message: `Private Preview · ${revisionLabel} · only ${outputName} is affected.` }
        : { key, phase: refusalPhase(result.refusal.code), message: result.refusal.message, canReview: result.refusal.code === "unavailable" || result.refusal.code === "not-approved" })
    })
    return () => { if (operation.current === id) operation.current += 1 }
  }, [key, outputId, sceneId, approvalBlock, outputName, revisionLabel, rehearsal])

  if (!selection) return null

  const currentView = view.key === key
    ? view
    : rehearsal
      ? { key, phase: "ready" as const, message: "Rehearsal only. Taking this scene changes this computer, not the real screens." }
      : approvalBlock
      ? { key, phase: "blocked" as const, message: approvalBlock }
      : { key, phase: "checking" as const, message: "Checking this scene and output with the host. Nothing changes until you Take." }

  const review = async () => {
    if (approvalBlock || rehearsal) return
    const id = ++operation.current
    setView({ key, phase: "checking", message: "Reviewing the current scene and output with the host. Nothing changes." })
    const result = await readSceneTakeRevisions(selection.outputId, selection.sceneId)
    if (operation.current !== id || currentKey.current !== key || blockRef.current) return
    setView(result.ok
      ? { key, phase: "ready", seen: result.seen, message: `Reviewed ${selection.revisionLabel}. Take remains a separate action.` }
      : { key, phase: refusalPhase(result.refusal.code), message: result.refusal.message, canReview: result.refusal.code === "unavailable" || result.refusal.code === "not-approved" })
  }

  const take = async () => {
    if (currentView.phase !== "ready" || selection.disabledReason || approvalBlock) return
    if (rehearsal) {
      useBroadcastStore.getState().takeScene(selection.outputId, selection.sceneId)
      setView({ key, phase: "rehearsed", message: "Only the local rehearsal changed. The real output is unchanged." })
      return
    }
    if (!currentView.seen) return
    const id = ++operation.current
    setView({ key, phase: "taking", message: `Checking and applying ${selection.sceneName} on ${selection.outputName}…` })
    const result = await takeSceneOnOutput(selection.outputId, selection.sceneId, currentView.seen, () =>
      operation.current === id && currentKey.current === key && !blockRef.current,
    )
    if (operation.current !== id || currentKey.current !== key) return
    if (!result.ok) {
      setView({ key, phase: refusalPhase(result.refusal.code), message: `${result.refusal.message}${result.refusal.code === "stale" ? ". No scene was applied; review again before another Take." : ""}`, canReview: result.refusal.code === "stale" || result.refusal.code === "not-approved" || result.refusal.code === "not-applied" || result.refusal.code === "unavailable" })
      return
    }

    if (result.receiver.kind === "none") {
      setView({ key, phase: "sent", message: `${selection.sceneName} was applied to ${selection.outputName}. This output does not report receiver acknowledgment.` })
      return
    }
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const drawn = await sceneTakeDrawn(selection.outputId, result.receiver)
      if (operation.current !== id || currentKey.current !== key) return
      if (drawn !== "waiting") {
        const phase = drawn === "confirmed" ? "confirmed" : drawn === "no-receiver" ? "no-receiver" : "unknown"
        const message = drawn === "confirmed"
          ? `${selection.sceneName} was applied to ${selection.outputName}; the receiver confirmed its frame.`
          : drawn === "no-receiver"
            ? `${selection.sceneName} was applied to ${selection.outputName}; no receiver was connected to confirm its frame.`
            : `${selection.sceneName} was applied to ${selection.outputName}; receiver confirmation is unavailable.`
        setView({ key, phase, message })
        return
      }
      await pause(500)
    }
    if (operation.current === id && currentKey.current === key) {
      setView({ key, phase: "waiting", message: `${selection.sceneName} was applied to ${selection.outputName}; still waiting for the receiver to draw its frame.` })
    }
  }

  const blocked = approvalBlock || selection.disabledReason
  const canTake = currentView.phase === "ready" && (rehearsal || !!currentView.seen) && !blocked
  const canReview = currentView.phase === "stale" || !!currentView.canReview
  const actionLabel = rehearsal
    ? `Take scene ${selection.sceneName} in rehearsal on ${selection.outputName}`
    : currentView.phase === "stale" ? `Review ${selection.sceneName} for ${selection.outputName} again` : `Take scene ${selection.sceneName} to ${selection.outputName}`
  const buttonText = rehearsal
    ? currentView.phase === "rehearsed" ? "Rehearsed" : "Take in rehearsal"
    : currentView.phase === "stale" ? "Review again" : currentView.phase === "checking" ? "Checking…" : currentView.phase === "taking" ? "Taking…" : `Take ${selection.sceneName} to ${selection.outputName}`

  return (
    <div data-slot="live-scene-take-action" data-program-context-row title={selection.details ?? undefined} className="flex shrink-0 flex-col gap-1.5 border-b border-border px-3 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.6875rem] font-semibold" title={`${selection.sceneName} → ${selection.outputName}`}>
            {selection.sceneName} <span className="text-muted-foreground">→ {selection.outputName}</span>
          </p>
        </div>
        {currentView.phase === "stale" && canReview ? (
          <Button type="button" size="sm" variant="outline" aria-label={actionLabel} onClick={() => void review()}>
            <RotateCcwIcon /> Review scene
          </Button>
        ) : (
          <Button type="button" size="sm" aria-label={actionLabel} title={blocked ?? currentView.message ?? `Take this saved scene to ${selection.outputName} only.`} disabled={!canTake} onClick={() => void take()}>
            <LayersIcon /> {buttonText}
          </Button>
        )}
      </div>
      {(currentView.phase === "ready" && selection.disabledReason ? selection.disabledReason : currentView.message) && <p role="status" aria-live="polite" aria-atomic="true" className="text-[0.6875rem] leading-snug text-muted-foreground">{currentView.phase === "ready" && selection.disabledReason ? selection.disabledReason : currentView.message}</p>}
      {canReview && currentView.phase !== "stale" && (
        <Button type="button" size="xs" variant="ghost" aria-label={`Retry host review for ${selection.sceneName} on ${selection.outputName}`} onClick={() => void review()} className="min-h-9 self-start">
          <RotateCcwIcon /> Retry host review
        </Button>
      )}
    </div>
  )
}

const refusalPhase = (code: "stale" | "not-congregation" | "not-approved" | "unavailable" | "invalid" | "not-main-desk" | "not-applied"): Phase => code === "stale" ? "stale" : "refused"
