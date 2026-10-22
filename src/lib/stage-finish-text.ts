import type { StageFinish } from "@/types"

/** "Ends 10:42 · 5 min late", "Ends 10:37" — the stage display's service clock line. */
export function stageFinishText(f: StageFinish): string {
  return `Ends ${f.time}${f.lateMin > 0 ? ` · ${f.lateMin} min late` : f.lateMin < 0 ? ` · ${-f.lateMin} min early` : ""}`
}
