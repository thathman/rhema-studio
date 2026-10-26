import { useEffect, useRef, useState } from "react"
import QRCode from "qrcode"
import { invoke } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useSettingsStore } from "@/stores/settings-store"

interface HttpStatus {
  running: boolean
  port: number | null
  lan?: boolean
  tls_port?: number | null
}

interface PairQr {
  host: string
  url: string
  image: string
}

/** The existing LAN pairing code, shared by Connections and the advanced Remote settings page. */
export function PairDeviceDialog({ label = "Pair a device" }: { label?: string }) {
  const devices = useSettingsStore((s) => s.remoteDevices)
  const [open, setOpen] = useState(false)
  const [http, setHttp] = useState<HttpStatus | null>(null)
  const [pairCode, setPairCode] = useState<string | null>(null)
  const [pairStartedAt, setPairStartedAt] = useState("")
  const [pairQr, setPairQr] = useState<PairQr | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pairedInWindow = pairCode !== null && devices.some((device) => device.paired_at > pairStartedAt)
  const showPairCode = pairCode !== null && !pairedInWindow

  useEffect(() => {
    if (!open) return
    let alive = true
    void invoke<HttpStatus>("get_http_status").then((status) => { if (alive) setHttp(status) }, () => { if (alive) setHttp(null) })
    const closed = () => { setPairCode(null); setMessage("The pairing window closed. Start another when the device is ready.") }
    window.addEventListener("rhema:pair-closed", closed)
    return () => { alive = false; window.removeEventListener("rhema:pair-closed", closed) }
  }, [open])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    void invoke("remote_pair_cancel").catch(() => {})
  }, [])

  const makeQr = async (host: string, code: string, status: HttpStatus) => {
    const url = !host ? "" : status.tls_port
      ? `https://${host}:${status.tls_port}/remote#code=${code}`
      : status.port ? `http://${host}:${status.port}/remote#code=${code}` : ""
    const image = url ? await QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 256 }) : ""
    setPairQr({ host, url, image })
  }

  const startPairing = async () => {
    setError(null)
    setMessage(null)
    try {
      const current = await invoke<HttpStatus>("get_http_status")
      setHttp(current)
      if (!current.running || !current.port) {
        setError("Turn on the network listener in Settings → Remote control before pairing.")
        return
      }
      const code = await invoke<string>("remote_pair_start")
      setPairStartedAt(new Date().toISOString())
      setPairCode(code)
      setPairQr(null)
      const host = current.lan ? await invoke<string | null>("remote_lan_address").catch(() => null) : null
      if (current.lan) await makeQr(host ?? "", code, current)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        setPairCode(null)
        setMessage("The two-minute pairing window ended. Start another when the device is ready.")
      }, 120_000)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const refreshHttpStatus = async () => {
    setError(null)
    try {
      setHttp(await invoke<HttpStatus>("get_http_status"))
    } catch (cause) {
      setHttp(null)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const cancelPairing = async () => {
    setPairCode(null)
    setPairQr(null)
    if (timer.current) clearTimeout(timer.current)
    await invoke("remote_pair_cancel").catch(() => {})
  }

  const changeAddress = async (host: string) => {
    const current = http
    const code = pairCode
    if (!current?.port || !code || !/^[\w.:-]+$/.test(host)) return
    try { await makeQr(host, code, current) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => { setOpen(true); setError(null); setMessage(null) }}>{label}</Button>
      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) void cancelPairing() }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Pair a phone or computer</DialogTitle>
            <DialogDescription>Pair on the church network with a short-lived code. The device is added only after it answers correctly.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 text-xs">
            {!http?.running ? (
              <div className="rounded-md border border-border bg-muted/40 p-3">
                <p>The network listener is off. Start it before pairing; the main computer still runs the service on its own.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => openSettingsRemote()}>Open network settings</Button>
                  <Button size="sm" variant="ghost" onClick={() => void refreshHttpStatus()}>Check again</Button>
                </div>
              </div>
            ) : !http.lan ? (
              <div className="rounded-md bg-muted/40 p-3">
                <p>The listener is on this computer only. Turn on “Accept commands from other devices on this network” in network settings to pair over the church LAN.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => openSettingsRemote()}>Open network settings</Button>
                  <Button size="sm" variant="ghost" onClick={() => void refreshHttpStatus()}>Check again</Button>
                </div>
              </div>
            ) : null}
            {showPairCode ? (
              <div className="rounded-md border border-border bg-muted/40 p-3">
                {pairQr && (
                  <div className="mb-3 flex items-start gap-3">
                    {pairQr.image && <img src={pairQr.image} alt="Pairing link QR code" className="size-32 shrink-0 rounded bg-white p-1" />}
                    <div className="flex min-w-0 flex-col gap-2 text-muted-foreground">
                      <p>{pairQr.image ? "Scan on a phone on the same Wi-Fi to open the remote page." : "No network address was found. Enter an address the other device can reach to make a QR code."} For an OBS Companion computer, enter this host address and code in its Join form.</p>
                      <label className="flex flex-wrap items-center gap-1.5">This computer's network address
                        <Input aria-label="This computer's address for pairing" defaultValue={pairQr.host} placeholder="192.168.1.20" className="h-7 w-36 text-xs" onBlur={(event) => { const nextHost = event.currentTarget.value.trim(); if (nextHost && nextHost !== pairQr.host) void changeAddress(nextHost) }} />
                      </label>
                    </div>
                  </div>
                )}
                <p className="text-muted-foreground">Use once within two minutes. Three incorrect codes close the window.</p>
                <p aria-label="Pairing code" className="my-1 font-mono text-3xl font-bold tracking-[0.3em]">{pairCode}</p>
                {pairQr?.url && <p className="break-all text-muted-foreground">Host: {new URL(pairQr.url).host}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => void cancelPairing()}>Cancel pairing</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={!http?.running || !http.lan || pairCode !== null} onClick={() => void startPairing()}>Show pairing code</Button>
                {message && <span role="status" className="text-muted-foreground">{message}</span>}
                {pairedInWindow && <span role="status" className="text-muted-foreground">Device paired. Review its role in Settings → Remote control.</span>}
              </div>
            )}
            {error && <p role="alert" className="text-destructive">{error}</p>}
            <p className="text-muted-foreground">The paired device starts with Present permission. Choose a narrower role or revoke it later in Settings → Remote control. Internet pairing is not enabled.</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function openSettingsRemote(): void {
  // Imported lazily here to keep the pairing dialog independent of the Settings page's module tree.
  void import("@/lib/settings-dialog").then(({ openSettings }) => openSettings("remote"))
}
