// Delete from My Designs (#851 G7): refused, with the reason, while anything can still show the
// design. Archive is the safe way to tidy the list; delete is only for a design nothing uses.
import type { DesignSummary, DesignUse } from "@/design-engine/design-store"
import { sceneForOutput } from "@/lib/scenes"
import type { BroadcastOutput, Scene } from "@/types"

const quoted = (names: string[]) => {
  const unique = [...new Set(names)]
  const shown = unique.slice(0, 3).map((name) => `“${name}”`).join(", ")
  return unique.length > 3 ? `${shown} and ${unique.length - 3} more` : shown
}

/**
 * Why this design cannot be deleted, or null when nothing uses it. Uses are the Used On graph:
 * services whose moments pin one of its versions, saved scenes made from it, and outputs whose
 * look (their scene, or the snapshot they took) is made from it. A design with any version is
 * kept even when nothing here pins it: the host refuses (versions are immutable), and a scene on
 * another desk may pin it.
 */
export function designDeleteRefusal(
  item: Pick<DesignSummary, "id" | "title" | "latestVersion">,
  uses: readonly DesignUse[],
  scenes: readonly Scene[],
  outputs: readonly Pick<BroadcastOutput, "name" | "role" | "sceneId" | "sceneSnapshot">[],
): string | null {
  const services = uses.map((use) => use.title || "Untitled service")
  const madeFrom = scenes.filter((scene) => scene.design?.id === item.id).map((scene) => scene.name)
  const showing = outputs.filter((output) => sceneForOutput(output, scenes)?.design?.id === item.id).map((output) => output.name)
  const reasons = [
    services.length ? `${services.length === 1 ? "service" : "services"} ${quoted(services)}` : "",
    madeFrom.length ? `saved ${madeFrom.length === 1 ? "scene" : "scenes"} ${quoted(madeFrom)}` : "",
    showing.length ? `the look on ${showing.length === 1 ? "output" : "outputs"} ${quoted(showing)}` : "",
  ].filter(Boolean)
  if (reasons.length) return `“${item.title}” cannot be deleted: it is used by ${reasons.join("; ")}. Archive it instead to hide it from My Designs; everything that uses it keeps working.`
  if (item.latestVersion) return `“${item.title}” cannot be deleted: it has saved versions a service or scene may pin. Archive it instead to hide it from My Designs.`
  return null
}
