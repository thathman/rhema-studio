import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useObsStore } from "@/stores/obs-store"
import { useSettingsStore } from "@/stores/settings-store"

/** OBS connection (obs-websocket v5, OBS → Tools → WebSocket Server Settings). Optional: nothing needs OBS to present. */
export function ObsSettingsBlock() {
  const obs = useSettingsStore((s) => s.obs)
  const setObs = useSettingsStore((s) => s.setObs)
  const status = useObsStore((s) => s.status)
  const error = useObsStore((s) => s.error)
  // Edited locally and applied with "Save", so a half-typed address or password is never tried.
  const [draft, setDraft] = useState({ host: obs.host, port: String(obs.port), password: obs.password })
  // The saved password arriving later (keychain read again) fills an untouched box, so Save never blanks it.
  const savedPassword = useRef(obs.password)
  useEffect(() => {
    if (obs.password !== savedPassword.current) {
      const before = savedPassword.current
      setDraft((d) => (d.password === before ? { ...d, password: obs.password } : d))
      savedPassword.current = obs.password
    }
  }, [obs.password])
  const port = Number(draft.port)
  const portOk = Number.isInteger(port) && port > 0 && port < 65536
  const changed = draft.host !== obs.host || draft.port !== String(obs.port) || draft.password !== obs.password
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3 text-xs">
      <label className="flex items-center gap-2 font-medium">
        <input type="checkbox" checked={obs.enabled} onChange={(e) => setObs({ enabled: e.target.checked })} />
        Connect to OBS (recording status, marks and OBS's scenes)
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="OBS address" value={draft.host} onChange={(e) => setDraft({ ...draft, host: e.target.value })} placeholder="127.0.0.1" className="h-7 w-40 text-xs" />
        <Input aria-label="OBS port" inputMode="numeric" value={draft.port} onChange={(e) => setDraft({ ...draft, port: e.target.value.replace(/[^0-9]/g, "") })} placeholder="4455" className="h-7 w-24 text-xs" />
        <Input aria-label="OBS WebSocket password" type="password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} placeholder="password (if set in OBS)" className="h-7 w-48 text-xs" autoComplete="off" />
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!changed || !portOk || !draft.host.trim()} onClick={() => setObs({ host: draft.host.trim(), port, password: draft.password })}>Save</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {obs.enabled ? (status === "connected" ? "Connected." : status === "connecting" ? "Connecting…" : `Not connected${error ? `: ${error}` : ""}. Retrying every 15 seconds.`) : "Off. In OBS: Tools → WebSocket Server Settings → Enable, then copy the port and password here."} The password is kept in the system keychain (or this computer's settings file where there is none). Use a staff-only network: the login answer travels unencrypted.
      </p>
    </div>
  )
}
