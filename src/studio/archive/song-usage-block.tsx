import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { save } from "@tauri-apps/plugin-dialog"
import { writeTextFile } from "@tauri-apps/plugin-fs"
import { DownloadIcon, ListMusicIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { defaultRange, type SongUsage } from "@/lib/song-usage"
import { describeError } from "@/studio/library/content-actions"
import { USAGE_COMMAND as COMMAND, usageReportCsv, type UsageBasis } from "@/studio/archive/song-usage-report"

/** Which songs the church used, for its licence (CCLI) report (PRD FR-09). */
export function SongUsageBlock() {
  const [range, setRange] = useState(defaultRange)
  const [basis, setBasis] = useState<UsageBasis>("shown")
  const [rows, setRows] = useState<SongUsage[] | null>(null)
  const [busy, setBusy] = useState(false)
  const load = async () => {
    setBusy(true)
    try {
      setRows(await invoke<SongUsage[]>(COMMAND[basis], range))
    } catch (e) {
      toast.error(describeError(e))
    } finally {
      setBusy(false)
    }
  }
  const saveCsv = async () => {
    if (!rows) return
    const path = await save({ defaultPath: `song-usage-${basis === "planned" ? "planned-" : ""}${range.from}-to-${range.to}.csv`, filters: [{ name: "CSV", extensions: ["csv"] }] })
    if (!path) return
    try {
      await writeTextFile(path, usageReportCsv(rows, range.from, range.to, basis))
      toast.success(`Saved to ${path}`)
    } catch (e) {
      toast.error(describeError(e))
    }
  }
  const countLabel = basis === "shown" ? "Services" : "Planned in"
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="mb-1 flex items-center gap-2 font-medium"><ListMusicIcon className="size-4" /> {basis === "shown" ? "Songs shown in services" : "Songs planned in services"}</p>
      <p className="mb-2 text-xs text-muted-foreground">
        {basis === "shown"
          ? "How many service runs showed each song on screen, from the run journal, for a licence (CCLI) report. A song planned but never shown is not counted."
          : "Planned only: how many saved services dated in the range include each song. This counts the plan, not what was sung."}
      </p>
      <div role="group" aria-label="Count songs by" className="mb-2 flex w-fit rounded-md border border-border p-0.5 text-xs">
        {(["shown", "planned"] as const).map((b) => (
          <button key={b} type="button" aria-pressed={basis === b} onClick={() => { setBasis(b); setRows(null) }} className={`rounded px-2.5 py-1 ${basis === b ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {b === "shown" ? "Shown in services" : "Planned"}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Input type="date" aria-label="From" value={range.from} onChange={(e) => { setRange((r) => ({ ...r, from: e.target.value })); setRows(null) }} className="h-8 w-36 text-xs" />
        <span>to</span>
        <Input type="date" aria-label="To" value={range.to} onChange={(e) => { setRange((r) => ({ ...r, to: e.target.value })); setRows(null) }} className="h-8 w-36 text-xs" />
        <Button size="sm" variant="outline" disabled={busy || !range.from || !range.to} onClick={() => void load()}>Show</Button>
        <Button size="sm" variant="outline" disabled={!rows || rows.length === 0} onClick={() => void saveCsv()}><DownloadIcon /> Save as CSV…</Button>
      </div>
      {rows && (
        rows.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">{basis === "shown" ? "No song was shown during a service run in this range." : "No songs in saved services dated in this range."}</p>
        ) : (
          <table className="mt-2 w-full text-xs" aria-label={basis === "shown" ? "Songs shown" : "Songs planned"}>
            <thead className="text-left text-muted-foreground">
              <tr><th className="font-normal">Type</th><th className="font-normal">Song</th><th className="font-normal">Hymn numbers</th><th className="font-normal">CCLI</th><th className="text-right font-normal">{countLabel}</th><th className="text-right font-normal">Last</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.song_id} className="border-t border-border">
                  <td className="py-1 pr-2">{r.hymn ? "Hymn" : "Song"}</td>
                  <td className="truncate py-1 pr-2">{r.title}</td>
                  <td className="py-1 pr-2">{r.hymn_numbers.join(", ") || "—"}</td>
                  <td className="tabular-nums">{r.ccli_number ?? (r.licence === "public_domain" ? "public domain" : "—")}</td>
                  <td className="text-right tabular-nums">{r.services}{basis === "planned" ? " planned" : ""}</td>
                  <td className="text-right tabular-nums">{r.last_date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </div>
  )
}
