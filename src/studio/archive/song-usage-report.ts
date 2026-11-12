import { usageCsv, type SongUsage } from "@/lib/song-usage"

/**
 * What a song usage count is based on (#843 S19). "shown": songs that went on screen during a
 * service run (the run journal), which is what the licence report needs. "planned": songs in saved
 * services dated in the range, which counts the plan, not what happened, and is labelled so.
 */
export type UsageBasis = "shown" | "planned"

export const USAGE_COMMAND: Record<UsageBasis, string> = { shown: "content_song_usage_shown", planned: "content_song_usage" }

/** The report as CSV, saying in its first line and its count column what was counted. */
export function usageReportCsv(rows: SongUsage[], from: string, to: string, basis: UsageBasis): string {
  const lines = usageCsv(rows, from, to).split("\n")
  lines[0] = basis === "shown"
    ? `# Song usage ${from} to ${to} (shown on screen during service runs)`
    : `# Song usage ${from} to ${to} (PLANNED: in saved services with a date; not a record of what was sung)`
  lines[1] = lines[1].replace(",Services,", basis === "shown" ? ",Services shown in," : ",Services planned in,")
  return lines.join("\n")
}
