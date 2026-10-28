import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { testObsConnection } from "@/lib/obs"
import { useObsStore } from "@/stores/obs-store"
import { sameObs, useSettingsStore, type ObsProfile } from "@/stores/settings-store"

type TestResult = { ok: boolean; text: string } | "testing"

/** Try an OBS once and say what happened; nothing in OBS changes. */
async function runTest(o: { host: string; port: number; password: string }): Promise<{ ok: boolean; text: string }> {
  try {
    return { ok: true, text: `Reached ${await testObsConnection(o)}` }
  } catch (e) {
    return { ok: false, text: `Not reached: ${e instanceof Error ? e.message : String(e)}` }
  }
}

function TestLine({ result }: { result: TestResult | undefined }) {
  if (!result) return null
  if (result === "testing") return <span role="status" className="text-muted-foreground">Testing…</span>
  return <span role="status" className={result.ok ? "text-confidence-high" : "font-semibold text-confidence-mid"}>{result.text}</span>
}

/**
 * Saved OBS computers (#197): "Main stream PC", "Backup laptop". Use puts one in the connection;
 * Test tries it once without using it. This computer's list only; passwords in the keychain.
 */
function ObsProfiles() {
  const obs = useSettingsStore((s) => s.obs)
  const profiles = useSettingsStore((s) => s.obsProfiles)
  const setObsProfiles = useSettingsStore((s) => s.setObsProfiles)
  const setObs = useSettingsStore((s) => s.setObs)
  const [label, setLabel] = useState("")
  const [tests, setTests] = useState<Record<string, TestResult>>({})
  const test = async (p: ObsProfile) => {
    setTests((t) => ({ ...t, [p.id]: "testing" }))
    const r = await runTest(p)
    setTests((t) => ({ ...t, [p.id]: r }))
  }
  const save = () => {
    const name = label.trim()
    if (!name) return
    const same = profiles.find((p) => sameObs(p, obs))
    const next: ObsProfile = { id: same?.id ?? `obs-${Date.now().toString(36)}`, label: name, host: obs.host, port: obs.port, password: obs.password }
    setObsProfiles(same ? profiles.map((p) => (p.id === same.id ? next : p)) : [...profiles, next])
    setLabel("")
  }
  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-2">
      <p className="font-medium">Saved OBS computers</p>
      {profiles.length === 0 ? (
        <p className="text-muted-foreground">None yet. Save the connection above with a name (for example “Main stream PC” or “Backup laptop”) to switch between them quickly.</p>
      ) : (
        <ul aria-label="Saved OBS computers" className="flex flex-col divide-y divide-border">
          {profiles.map((p) => {
            const inUse = sameObs(p, obs) && p.password === obs.password
            return (
              <li key={p.id} aria-label={p.label} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">{p.label}</span>
                  <span className="text-muted-foreground"> · {p.host}:{p.port}{p.password ? " · password saved" : ""}</span>
                </span>
                {inUse && <span className="rounded-[5px] bg-tone-green px-[7px] py-[3px] text-[0.625rem] font-bold uppercase text-tone-green-foreground">In use</span>}
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={tests[p.id] === "testing"} onClick={() => void test(p)} aria-label={`Test ${p.label}`}>Test</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={inUse} onClick={() => setObs({ host: p.host, port: p.port, password: p.password })} aria-label={`Use ${p.label}`}>Use</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setObsProfiles(profiles.filter((x) => x.id !== p.id))} aria-label={`Remove ${p.label}`}>Remove</Button>
                {tests[p.id] && <span className="basis-full"><TestLine result={tests[p.id]} /></span>}
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Name for this OBS connection" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Main stream PC" className="h-7 w-48 text-xs" />
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!label.trim()} onClick={save}>Save this connection</Button>
      </div>
      <p className="text-muted-foreground">Test only connects and asks OBS its version; it never changes a scene, the stream or the recording. Use switches Rhema Studio to that OBS.</p>
    </div>
  )
}

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
  const [draftTest, setDraftTest] = useState<TestResult | undefined>(undefined)
  const testDraft = async () => {
    setDraftTest("testing")
    setDraftTest(await runTest({ host: draft.host, port, password: draft.password }))
  }
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
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!portOk || !draft.host.trim() || draftTest === "testing"} onClick={() => void testDraft()} aria-label="Test this OBS address">Test</Button>
        <TestLine result={draftTest} />
      </div>
      <p className="text-xs text-muted-foreground">
        {obs.enabled ? (status === "connected" ? "Connected." : status === "connecting" ? "Connecting…" : `Not connected${error ? `: ${error}` : ""}. Retrying every 15 seconds.`) : "Off. In OBS: Tools → WebSocket Server Settings → Enable, then copy the port and password here."} The password is kept in the system keychain (or this computer's settings file where there is none). Use a staff-only network: the login answer travels unencrypted.
      </p>
      <ObsProfiles />
    </div>
  )
}
