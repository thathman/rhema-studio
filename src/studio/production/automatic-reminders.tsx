import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import { parseReminderThresholds, REMINDER_ROLE_TARGETS, type ReminderPolicy } from "@/lib/timekeeper-reminders"
import { useSettingsStore } from "@/stores/settings-store"

const labelByRole: Record<string, string> = {
  timekeeper: "Timekeeper",
  bible: "Bible",
  worship: "Worship",
  screens: "Screens",
  present: "Present",
  stage: "Stage",
  camera: "Camera",
  obs: "OBS director",
}

function policyFrom(value: unknown): ReminderPolicy | null {
  if (!value || typeof value !== "object") return null
  const policy = value as Partial<ReminderPolicy>
  if (!Array.isArray(policy.thresholdsMin) || !policy.thresholdsMin.every((n) => Number.isInteger(n) && n >= 1 && n <= 180) || !Array.isArray(policy.to) || !policy.to.every((target) => typeof target === "string") || typeof policy.urgent !== "boolean") return null
  return { thresholdsMin: [...new Set(policy.thresholdsMin)].sort((a, b) => b - a).slice(0, 6), to: [...new Set(policy.to)].slice(0, 8), urgent: policy.urgent }
}

function errorWords(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Host-owned automatic Timekeeper notices. No timing reminder changes a screen or public output. */
export function AutomaticReminders() {
  const devices = useSettingsStore((state) => state.remoteDevices)
  const [thresholdsText, setThresholdsText] = useState("")
  const [targets, setTargets] = useState<string[]>([])
  const [urgent, setUrgent] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let current = true
    void invoke<unknown>("reminders_policy").then((value) => {
      const policy = policyFrom(value)
      if (!policy) throw new Error("The main computer returned an invalid reminder policy.")
      if (current) {
        setThresholdsText(policy.thresholdsMin.join(", "))
        setTargets(policy.to)
        setUrgent(policy.urgent)
      }
    }).catch((error: unknown) => { if (current) setLoadError(`Automatic reminders could not be loaded: ${errorWords(error)}`) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [])

  const parsed = parseReminderThresholds(thresholdsText)
  const roleOptions = REMINDER_ROLE_TARGETS.map((role) => ({ value: `role:${role}`, label: labelByRole[role] ?? role }))
  const pairedNames = [...new Set(devices.map((device) => device.name.trim()).filter(Boolean))]
  const knownTargets = new Set([...roleOptions.map((item) => item.value), ...pairedNames])
  const orphanedTargets = targets.filter((target) => !knownTargets.has(target))
  const changeTarget = (target: string, checked: boolean) => {
    setSaved(false)
    setTargets((current) => checked ? [...new Set([...current, target])] : current.filter((item) => item !== target))
  }

  const save = async () => {
    if (!parsed || targets.length > 8) return
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      const result = policyFrom(await invoke<unknown>("reminders_set_policy", { policy: { thresholdsMin: parsed, to: targets, urgent } }))
      if (!result) throw new Error("The main computer did not confirm the saved reminder policy.")
      setThresholdsText(result.thresholdsMin.join(", "))
      setTargets(result.to)
      setUrgent(result.urgent)
      setSaved(true)
    } catch (error) {
      setSaveError(`The main computer did not save these reminder rules: ${errorWords(error)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-label="Automatic Timekeeper reminders" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-[15px]">
      <div>
        <p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">Private Comms · main computer clock</p>
        <h2 className="mt-1 text-sm font-bold">Automatic reminders</h2>
        <p className="mt-1 text-xs text-muted-foreground">The main computer sends each selected reminder once as an event approaches. It pauses on Hold and never appears on a congregation screen or Stage display.</p>
      </div>
      {loading ? <p role="status" className="text-xs text-muted-foreground">Loading the main computer’s saved reminder rules…</p> : loadError ? <p role="alert" className="text-xs text-destructive">{loadError}</p> : <>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-semibold">Minutes left</span>
          <input aria-label="Automatic reminder thresholds in minutes" value={thresholdsText} onChange={(event) => { setThresholdsText(event.currentTarget.value); setSaved(false) }} placeholder="10, 5, 2" inputMode="numeric" className="h-9 rounded-md border border-input bg-transparent px-2" />
          <span className="text-muted-foreground">Use up to six whole minutes from 1 to 180. Leave empty to turn automatic reminders off.</span>
          {parsed === null && <span role="alert" className="text-destructive">Enter up to six whole numbers from 1 to 180.</span>}
        </label>
        <fieldset className="rounded-md border border-border p-3">
          <legend className="px-1 text-xs font-semibold">Send privately to</legend>
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {roleOptions.map(({ value, label }) => <label key={value} className="flex items-center gap-2 text-xs">
              <input type="checkbox" aria-label={`Timekeeper reminder to ${label}`} checked={targets.includes(value)} disabled={saving || (!targets.includes(value) && targets.length >= 8)} onChange={(event) => changeTarget(value, event.currentTarget.checked)} />
              <span>{label} desk</span>
            </label>)}
            {pairedNames.map((name) => <label key={name} className="flex items-center gap-2 text-xs">
              <input type="checkbox" aria-label={`Timekeeper reminder to ${name}`} checked={targets.includes(name)} disabled={saving || (!targets.includes(name) && targets.length >= 8)} onChange={(event) => changeTarget(name, event.currentTarget.checked)} />
              <span>{name}</span>
            </label>)}
          </div>
          {orphanedTargets.map((target) => <label key={target} className="mt-2 flex items-center gap-2 text-xs text-confidence-mid">
            <input type="checkbox" aria-label={`Remove unavailable reminder recipient ${target}`} checked onChange={(event) => changeTarget(target, event.currentTarget.checked)} />
            <span>Saved recipient “{target}” is not currently paired</span>
          </label>)}
          {targets.length === 0 && <p className="mt-2 text-xs text-muted-foreground">No recipients selected; no automatic notices will be sent.</p>}
          {targets.length > 8 && <p role="alert" className="mt-2 text-xs text-destructive">Choose no more than eight recipients.</p>}
        </fieldset>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" aria-label="Mark automatic reminders urgent" checked={urgent} disabled={saving} onChange={(event) => { setUrgent(event.currentTarget.checked); setSaved(false) }} />
          <span><b>Urgent</b> · show a prominent priority in Comms</span>
        </label>
        {saveError && <p role="alert" className="text-xs text-destructive">{saveError}</p>}
        {saved && <p role="status" className="text-xs font-semibold text-confidence-high">Reminder rules saved on this computer.</p>}
        <div><Button size="sm" variant="outline" disabled={saving || parsed === null || targets.length > 8} onClick={() => void save()}>{saving ? "Saving rules…" : "Save reminder rules"}</Button></div>
      </>}
    </section>
  )
}
