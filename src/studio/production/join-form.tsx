import { useEffect, useRef, useState } from "react"
import { MonitorIcon, SearchIcon, ShieldCheckIcon } from "lucide-react"
import { invoke } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import { certificateWords, type PairedHost } from "@/lib/host-certificate"
import { pairingLabel } from "@/lib/setup-readiness"
import { useJoin } from "@/stores/join-store"
import { useSettingsStore } from "@/stores/settings-store"

/** A card in Production → Operators and on the OBS companion's join form. */
export function Card({ title, kicker, children }: { title: string; kicker: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-xs">
      <div>
        <p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">{kicker}</p>
        <h3 className="text-sm font-bold">{title}</h3>
      </div>
      {children}
    </section>
  )
}

/** A Rhema host heard on the network (host_discover): its name and ip:port. */
type FoundHost = { name: string; address: string }

/**
 * Join a host: Rhema looks for hosts on the network when this opens (Find hosts looks again), and
 * picking one fills its address, or type it. Nothing is filled in by itself and the pairing code is
 * always typed: a computer on the network can call itself anything, and the host checks the code.
 */
export function JoinForm({ asCompanion = false, checkCertificate = false }: { asCompanion?: boolean; checkCertificate?: boolean } = {}) {
  const error = useJoin((s) => s.error)
  const address = useSettingsStore((s) => s.joinAddress)
  const token = useSettingsStore((s) => s.joinToken)
  // The name the host sees for this desk: the last one used, else "operator · this computer" (#298 S2.3).
  const [form, setForm] = useState(() => {
    const st = useSettingsStore.getState()
    return { address, code: "", name: st.joinName || pairingLabel(st.operatorName, st.setup.deviceName, st.setup.deviceId) }
  })
  // null until the first look is back; it starts as soon as this opens.
  const [hosts, setHosts] = useState<FoundHost[] | null>(null)
  const [finding, setFinding] = useState(true)
  const [findError, setFindError] = useState<string | null>(null)
  const codeInput = useRef<HTMLInputElement>(null)
  const cert = useHostCertificate(checkCertificate ? form.address : null)
  const look = () =>
    invoke<FoundHost[]>("host_discover")
      .then(
        (found) => {
          setHosts(Array.isArray(found) ? found : [])
          setFindError(null)
        },
        (e) => setFindError(String(e)),
      )
      .finally(() => setFinding(false))
  useEffect(() => {
    void look()
  }, []) // once, when the form opens
  const pick = (host: FoundHost) => {
    setForm((f) => ({ ...f, address: host.address }))
    codeInput.current?.focus()
  }
  return (
    <Card kicker="Another computer" title="Join a host">
      <p className="text-muted-foreground">
        {asCompanion ? "Pair with the Rhema that runs the service, to take its cameras into OBS here." : "Follow the Rhema that runs the service and help from here, as its host allows."} On the host: Settings → Remote control → Pair a device. Then pick the host below (check its address matches the one on its screen) or type its address, and type its code.
      </p>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Rhema hosts on this network">
        {hosts?.map((h) => (
          <Button key={h.address} type="button" size="sm" variant={form.address.trim() === h.address ? "secondary" : "outline"} aria-pressed={form.address.trim() === h.address} onClick={() => pick(h)} title={h.address}>
            <MonitorIcon aria-hidden />
            {h.name}
            <span className="text-muted-foreground tabular-nums">{h.address}</span>
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={finding}
          onClick={() => {
            setFinding(true)
            void look()
          }}
        >
          <SearchIcon aria-hidden />
          {finding ? "Looking for hosts…" : "Find hosts"}
        </Button>
      </div>
      {!finding && hosts?.length === 0 && !findError && <p className="text-muted-foreground">No host found. Is Remote control on at the host, accepting other devices, on the same network? You can also type its address.</p>}
      {findError && <p className="text-muted-foreground">{findError}. You can type the host's address.</p>}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void useJoin.getState().pair(form.address, form.code, form.name || (asCompanion ? "OBS computer" : "Operator"), asCompanion)
        }}
      >
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">Host address and port</span>
          <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="192.168.1.20:8080" required className="h-8 rounded-md border border-input bg-transparent px-2" />
        </label>
        {checkCertificate && <CertificateLine {...cert} />}
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">Pairing code</span>
            <input ref={codeInput} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} inputMode="numeric" required className="h-8 rounded-md border border-input bg-transparent px-2 tracking-widest" />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">This computer's name</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={60} className="h-8 rounded-md border border-input bg-transparent px-2" />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={checkCertificate && !cert.certificate}>Join</Button>
          {address && token && <Button type="button" size="sm" variant="outline" onClick={() => void useJoin.getState().connect()}>Join {address} again</Button>}
        </div>
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </form>
    </Card>
  )
}

/** A whole "host:port" (an address being typed is not looked at yet). */
const COMPLETE_ADDRESS = /^\S+:\d{1,5}$/

/**
 * Rhema Companion (#209): the certificate of the host being joined, read from its secure page as
 * soon as a whole address is there. Pairing pins it; the operator compares it with the host's.
 */
function useHostCertificate(address: string | null) {
  const [state, setState] = useState<{ address: string; certificate: string | null; error: string | null }>({ address: "", certificate: null, error: null })
  const wanted = address?.trim() ?? ""
  useEffect(() => {
    if (!wanted || !COMPLETE_ADDRESS.test(wanted)) return
    let alive = true
    // A moment after typing stops, so a half-typed port is not tried.
    const t = setTimeout(() => {
      invoke<PairedHost>("join_host_certificate", { address: wanted }).then(
        (p) => alive && setState({ address: wanted, certificate: p.certificate, error: null }),
        (e) => alive && setState({ address: wanted, certificate: null, error: String(e) }),
      )
    }, 400)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [wanted])
  const current = state.address === wanted
  return { checking: !!wanted && COMPLETE_ADDRESS.test(wanted) && !current, certificate: current ? state.certificate : null, error: current ? state.error : null, complete: COMPLETE_ADDRESS.test(wanted) }
}

function CertificateLine({ checking, certificate, error, complete }: ReturnType<typeof useHostCertificate>) {
  if (!complete) return <p className="text-muted-foreground">Rhema Companion talks to the host only over its secure page, and shows the host's certificate here before you join.</p>
  if (checking) return <p role="status" className="text-muted-foreground">Checking the host's secure page…</p>
  if (error) return <p role="alert" className="font-semibold">{error}</p>
  return (
    <p role="status" className="flex flex-wrap items-center gap-1.5">
      <ShieldCheckIcon aria-hidden className="size-3.5 text-primary-text" />
      <span>Host's certificate</span>
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono tracking-wide">{certificateWords(certificate ?? "")}</code>
      <span className="text-muted-foreground">The host shows the same in Settings → Remote control. If they differ, do not join.</span>
    </p>
  )
}
