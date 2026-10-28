import type { Scene } from "@/types"

export function sceneRevisionLabel(scene: Pick<Scene, "updatedAt">, hasUnsavedEdits = false, hasSavedRevision = true): string {
  if (hasUnsavedEdits) {
    return hasSavedRevision
      ? "Unsaved edits; Take saves a new revision first"
      : "New scene draft; Take saves its first revision first"
  }
  return scene.updatedAt > 0 ? new Date(scene.updatedAt).toLocaleString() : "Saved legacy revision (timestamp unavailable)"
}

export function sceneTakeDetails({
  outputName,
  sceneName,
  revision,
  actor,
  rehearsal,
}: {
  outputName: string
  sceneName: string
  revision: string
  actor: string
  rehearsal: boolean
}): string {
  return [
    `Affected output: ${outputName} only`,
    `Scene: ${sceneName}`,
    `Revision: ${revision}`,
    `Actor: ${actor.trim() || "Local operator (name not set)"}`,
    rehearsal ? "Scope: rehearsal only; the public screen stays unchanged" : "Scope: this congregation output",
  ].join(". ")
}
