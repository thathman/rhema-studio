import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { designStore, type DesignUse } from "@/design-engine/design-store"
import { pinnedSceneForVersion } from "@/design-engine/design-document-utils"
import { useBroadcastStore } from "@/stores/broadcast-store"
import type { Scene } from "@/types/scene"

function messageOf(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error && "message" in error) return String(error.message)
  return String(error)
}

/** Read-only summary of plan references and locally saved scenes pinned to a design. */
export function DesignUsagePanel({ designId }: { designId: string }) {
  const scenes = useBroadcastStore((state) => state.scenes)
  const pinnedScenes = useMemo(
    () => scenes.filter((scene) => scene.design?.id === designId),
    [designId, scenes],
  )
  const [result, setResult] = useState<{
    designId: string
    uses: DesignUse[]
    loading: boolean
    error: string
  }>({ designId, uses: [], loading: true, error: "" })
  const current = result.designId === designId
    ? result
    : { designId, uses: [], loading: true, error: "" }
  const [versionResult, setVersionResult] = useState<{
    designId: string
    latestVersion: number | null
    loading: boolean
    error: string
  }>({ designId, latestVersion: null, loading: true, error: "" })
  const versions = versionResult.designId === designId
    ? versionResult
    : { designId, latestVersion: null, loading: true, error: "" }
  const [sceneUpdate, setSceneUpdate] = useState<{
    sceneId: string
    status: "updating" | "error"
    message?: string
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    void designStore.usedOn(designId)
      .then((items) => {
        if (!cancelled) setResult({ designId, uses: items, loading: false, error: "" })
      })
      .catch((failure) => {
        if (!cancelled) setResult({ designId, uses: [], loading: false, error: "Service usage could not be loaded: " + messageOf(failure) })
      })
    return () => { cancelled = true }
  }, [designId])

  useEffect(() => {
    let cancelled = false
    void designStore.listVersions(designId)
      .then((items) => {
        if (!cancelled) {
          const latestVersion = items.reduce((latest, item) => Math.max(latest, item.version), 0) || null
          setVersionResult({ designId, latestVersion, loading: false, error: "" })
        }
      })
      .catch((failure) => {
        if (!cancelled) setVersionResult({ designId, latestVersion: null, loading: false, error: "Saved design versions could not be checked: " + messageOf(failure) })
      })
    return () => { cancelled = true }
  }, [designId])

  const updateScene = async (scene: Scene, versionNumber: number) => {
    setSceneUpdate({ sceneId: scene.id, status: "updating" })
    try {
      const version = await designStore.getVersion(designId, versionNumber)
      if (!version?.document || version.designId !== designId || version.version !== versionNumber) {
        throw new Error(`Design version ${versionNumber} could not be read from this computer.`)
      }
      const converted = pinnedSceneForVersion(version, "")
      if (!converted.scene || converted.issues.length > 0) {
        const reason = converted.issues.map((issue) => issue.message).join("; ")
        throw new Error(reason || "The design cannot be saved as a scene yet.")
      }
      const broadcast = useBroadcastStore.getState()
      const currentScene = broadcast.scenes.find((candidate) => candidate.id === scene.id)
      if (!currentScene) throw new Error("The saved scene no longer exists. Reopen Design and review the current scene list.")
      if (
        currentScene.updatedAt !== scene.updatedAt ||
        currentScene.design?.id !== scene.design?.id ||
        currentScene.design?.version !== scene.design?.version
      ) {
        throw new Error("The saved scene changed elsewhere. Reopen Design and review the current version before updating it.")
      }
      broadcast.saveScene({
        ...converted.scene,
        id: scene.id,
        name: scene.name,
        createdAt: scene.createdAt,
      })
      setSceneUpdate(null)
      toast.success("Saved scene updated", {
        description: `It now uses design v${versionNumber}. It has not been taken to an output.`,
      })
    } catch (error) {
      setSceneUpdate({
        sceneId: scene.id,
        status: "error",
        message: "This scene was not changed: " + messageOf(error),
      })
    }
  }

  return (
    <section aria-label="Used On" className="max-h-56 shrink-0 overflow-y-auto border-t border-border p-3">
      <h3 className="text-xs font-semibold">Used On</h3>
      <p className="mt-1 text-[0.6875rem] leading-relaxed text-muted-foreground">
        Services show current plan pins; their approved Live revision is listed separately.
      </p>
      {current.loading && <p className="mt-2 text-[0.6875rem] text-muted-foreground">Checking saved uses…</p>}
      {current.error && <p role="alert" className="mt-2 text-[0.6875rem] text-destructive">{current.error}</p>}
      {versions.error && <p role="alert" className="mt-2 text-[0.6875rem] text-destructive">{versions.error}</p>}
      {!current.loading && !current.error && current.uses.length === 0 && pinnedScenes.length === 0 && (
        <p className="mt-2 text-[0.6875rem] text-muted-foreground">No saved service or scene uses this design yet.</p>
      )}
      {pinnedScenes.map((scene) => (
        <div key={scene.id} className="mt-2 rounded-md bg-muted/40 px-2 py-1.5">
          <p className="truncate text-[0.6875rem] font-medium">{scene.name}</p>
          <p className="text-[0.6875rem] text-muted-foreground">Saved scene · version {scene.design?.version}</p>
          {!versions.loading && versions.latestVersion !== null && scene.design && versions.latestVersion > scene.design.version && (
            <button
              type="button"
              className="mt-1 min-h-10 rounded px-2 text-left text-xs font-medium text-primary-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              disabled={sceneUpdate?.status === "updating"}
              onClick={() => void updateScene(scene, versions.latestVersion!)}
            >
              {sceneUpdate?.sceneId === scene.id && sceneUpdate.status === "updating" ? "Updating saved scene…" : `Update to v ${versions.latestVersion}`}
            </button>
          )}
          {sceneUpdate?.sceneId === scene.id && sceneUpdate.status === "error" && (
            <p role="alert" className="mt-1 text-[0.6875rem] text-destructive">{sceneUpdate.message}</p>
          )}
        </div>
      ))}
      {current.uses.map((use) => (
        <div key={use.programId + ":" + use.itemId} className="mt-2 rounded-md bg-muted/40 px-2 py-1.5">
          <p className="truncate text-[0.6875rem] font-medium">{use.title}</p>
          <p className="truncate text-[0.6875rem] text-muted-foreground">{use.reference} · version {use.version}</p>
          <p className="text-[0.6875rem] text-muted-foreground">
            Plan revision {use.revision} · Live approved revision {use.approvedRevision ?? "none"}
          </p>
        </div>
      ))}
    </section>
  )
}
