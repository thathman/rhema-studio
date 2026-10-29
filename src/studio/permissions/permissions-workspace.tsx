import { Fragment, useEffect, useState } from "react"
import { CheckIcon, CircleAlertIcon, KeyRoundIcon, RefreshCwIcon, ShieldCheckIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { acceptSceneRequest, declineSceneRequest } from "@/lib/desk-scenes"
import { REMOTE_ROLES, asRemoteRole, roleLabel } from "@/lib/remote-roles"
import { setDeskControl } from "@/lib/desk-control"
import { useJoin } from "@/stores/join-store"
import { useNotices } from "@/stores/notices-store"
import { useSceneApprovalsStore, hydrateSceneApprovals, reloadSceneApprovals, type SceneEditApproval } from "@/stores/scene-approvals-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useBroadcastStore } from "@/stores/broadcast-store"

const dateWords = (at: number) => new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })

/** Host-owned access controls and durable scene approvals. Joined desks can inspect, never decide. */
export function PermissionsWorkspace() {
  const joinStatus = useJoin((s) => s.status)
  const requests = useSceneApprovalsStore((s) => s.requests)
  const hydrated = useSceneApprovalsStore((s) => s.hydrated)
  const loadError = useSceneApprovalsStore((s) => s.error)
  const remoteDevices = useSettingsStore((s) => s.remoteDevices)
  const outputs = useBroadcastStore((s) => s.outputs)
  const congregationOutputs = outputs.filter((output) => (output.role ?? "congregation") === "congregation")
  const [busy, setBusy] = useState<string | null>(null)
  const [reloading, setReloading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const isHost = joinStatus === "off"
  const pending = requests.filter((request) => request.status === "pending" || request.status === "needs-review")
  const ordered = [...requests].sort((a, b) => b.at - a.at)

  useEffect(() => { void hydrateSceneApprovals().catch(() => {}) }, [])

  const decide = async (request: SceneEditApproval, action: "accept" | "decline") => {
    setBusy(request.id)
    setErrors((current) => ({ ...current, [request.id]: "" }))
    try {
      if (action === "accept") {
        const why = await acceptSceneRequest(request.id)
        if (why) throw new Error(why)
        const me = useSettingsStore.getState().operatorName.trim() || "Main desk"
        const notice = useNotices.getState().notices.find((item) => item.action?.kind === "sceneEdit" && item.action.value === request.id)
        if (notice) useNotices.getState().answer(notice.id, me, "ready")
      } else {
        if (!await declineSceneRequest(request.id)) throw new Error("The decision could not be saved on this host.")
        const me = useSettingsStore.getState().operatorName.trim() || "Main desk"
        const notice = useNotices.getState().notices.find((item) => item.action?.kind === "sceneEdit" && item.action.value === request.id)
        if (notice) useNotices.getState().answer(notice.id, me, "unable")
      }
    } catch (error) {
      setErrors((current) => ({ ...current, [request.id]: error instanceof Error ? error.message : String(error) }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5 px-8 pt-6 pb-16 max-[1200px]:px-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">Your church · host decisions</p>
            <h1 className="mt-1 text-2xl leading-tight font-bold tracking-[-0.035em]">Permissions</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Review changes from joined desks and manage what paired devices can do. Only this computer’s main host can approve or change access.</p>
          </div>
        </header>

        {!isHost && <p role="status" className="rounded-md border border-border bg-muted/40 p-3 text-sm">This joined desk is read-only for approvals and device access. Ask the main host to make changes.</p>}

        <section aria-labelledby="scene-approvals-title" className="rounded-lg border border-border bg-card shadow-panel">
          <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface-elevated px-4 py-3">
            <ShieldCheckIcon aria-hidden className="size-4 text-muted-foreground" />
            <div className="min-w-0 flex-1"><h2 id="scene-approvals-title" className="font-semibold">Scene change requests</h2><p className="text-xs text-muted-foreground">Saved on this host, including after a restart. Accept never takes a scene live.</p></div>
            <Badge variant={pending.length ? "amber" : "neutral"}>{pending.length} to review</Badge>
            {loadError && <Button size="sm" variant="outline" disabled={reloading} onClick={() => { setReloading(true); void reloadSceneApprovals().catch(() => {}).finally(() => setReloading(false)) }}><RefreshCwIcon /> Try again</Button>}
          </header>
          <div className="p-4">
            {loadError && <p role="alert" className="mb-3 flex items-start gap-2 text-sm text-destructive"><CircleAlertIcon className="mt-0.5 size-4 shrink-0" />Approval history could not be loaded: {loadError}</p>}
            {!hydrated && !loadError ? <p role="status" className="text-sm text-muted-foreground">Loading saved requests…</p> : ordered.length === 0 ? <p className="text-sm text-muted-foreground">No saved scene change requests.</p> : (
              <ul className="divide-y divide-border">
                {ordered.map((request) => {
                  const status = request.status === "needs-review" ? "Needs a fresh request" : request.status[0].toUpperCase() + request.status.slice(1)
                  const open = request.status === "pending" || request.status === "needs-review"
                  return (
                    <li key={request.id} className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{request.scene ? `Change “${request.name}”` : `Delete “${request.name}”`}</h3><Badge variant={request.status === "pending" ? "amber" : request.status === "approved" ? "green" : request.status === "declined" ? "neutral" : "rose"}>{status}</Badge></div>
                        <p className="mt-1 text-xs text-muted-foreground">From {request.by} · {dateWords(request.at)}{request.decidedBy ? ` · ${request.status} by ${request.decidedBy}` : ""}</p>
                        {request.reason && <p className="mt-1 text-xs text-muted-foreground">{request.reason}</p>}
                        {errors[request.id] && <p role="alert" className="mt-2 text-xs text-destructive">{errors[request.id]}</p>}
                      </div>
                      {isHost && open && <div className="flex gap-2">
                        {request.status === "pending" && <Button size="sm" disabled={busy === request.id} onClick={() => void decide(request, "accept")}><CheckIcon /> Accept</Button>}
                        <Button size="sm" variant="outline" disabled={busy === request.id} onClick={() => void decide(request, "decline")}><XIcon /> Decline</Button>
                      </div>}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>

        <section aria-labelledby="paired-access-title" className="rounded-lg border border-border bg-card shadow-panel">
          <header className="flex items-center gap-3 border-b border-border bg-surface-elevated px-4 py-3">
            <KeyRoundIcon aria-hidden className="size-4 text-muted-foreground" />
            <div><h2 id="paired-access-title" className="font-semibold">Paired device access</h2><p className="text-xs text-muted-foreground">Saved pairing records. A device is shown as paired; this list does not claim that it is online now. Individual Screens Takes remain the default. Group Take needs its own host grant and an exact target review on the desk.</p></div>
          </header>
          <div className="p-4">
            {remoteDevices.length === 0 ? <p className="text-sm text-muted-foreground">No devices are paired. The studio works on this computer without them.</p> : (
              <ul className="divide-y divide-border">
                {remoteDevices.map((device) => <li key={device.hash} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1"><p className="font-semibold">{device.name}</p><p className="text-xs text-muted-foreground">{roleLabel(device.role ?? "configure")} · paired {new Date(device.paired_at).toLocaleDateString()} · {device.paused ? "control paused" : "control available"}</p></div>
                  <label className="flex items-center gap-2 text-xs"><span>Role</span><select aria-label={`Role for ${device.name}`} disabled={!isHost} value={device.role ?? "configure"} onChange={(event) => { const role = asRemoteRole(event.target.value); if (role) void useSettingsStore.getState().setRemoteDeviceRole(device.hash, role) }} className="h-8 max-w-48 rounded-md border border-border bg-background px-2">
                    {REMOTE_ROLES.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                  </select></label>
                  {device.role === "screens" && <fieldset className="w-full rounded-md border border-border p-3">
                    <legend className="px-1 text-xs font-semibold">Individual scene Take outputs</legend>
                    {device.outputScope === undefined
                      ? <p role="status" className="mb-2 text-xs text-confidence-mid">Legacy Screens access needs scope review. Scene Takes are blocked until the host assigns outputs.</p>
                      : device.outputScope.length === 0
                        ? <p role="status" className="mb-2 text-xs text-muted-foreground">No outputs assigned; scene Takes are blocked.</p>
                        : <p className="mb-2 text-xs text-muted-foreground">Only the selected output can be taken or released from this desk.</p>}
                    {congregationOutputs.length === 0
                      ? <p className="text-xs text-muted-foreground">No congregation outputs are configured on this host.</p>
                      : <div className="flex flex-wrap gap-x-4 gap-y-2">{congregationOutputs.map((output) => <label key={output.id} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          aria-label={`${output.name} output access for ${device.name}`}
                          disabled={!isHost}
                          checked={device.outputScope?.includes(output.id) ?? false}
                          onChange={(event) => {
                            const current = device.outputScope ?? []
                            const next = event.target.checked ? [...current, output.id] : current.filter((id) => id !== output.id)
                            void useSettingsStore.getState().setRemoteDeviceOutputScope(device.hash, next)
                          }}
                        />
                        <span>{output.name}</span>
                      </label>)}</div>}
                  </fieldset>}
                  {device.role === "screens" && <fieldset className="w-full rounded-md border border-border p-3">
                    <legend className="px-1 text-xs font-semibold">Separate Group Take grant</legend>
                    <p className="mb-2 text-xs text-muted-foreground">This grant only permits explicit group Take requests. The desk must review every selected output before sending one request; it cannot use this grant to Take an output individually.</p>
                    {(device.outputScope ?? []).filter((id) => congregationOutputs.some((output) => output.id === id)).length === 0
                      ? <p role="status" className="text-xs text-muted-foreground">Assign individual congregation output access above before granting group Take.</p>
                      : <div className="flex flex-wrap gap-x-4 gap-y-2">{congregationOutputs.filter((output) => device.outputScope?.includes(output.id)).map((output) => <label key={output.id} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          aria-label={`${output.name} group Take access for ${device.name}`}
                          disabled={!isHost}
                          checked={device.groupTakeScope?.includes(output.id) ?? false}
                          onChange={(event) => {
                            const current = device.groupTakeScope ?? []
                            const next = event.target.checked ? [...current, output.id] : current.filter((id) => id !== output.id)
                            void useSettingsStore.getState().setRemoteDeviceGroupTakeScope(device.hash, next)
                          }}
                        />
                        <span>{output.name}</span>
                      </label>)}</div>}
                    {device.groupTakeScope === undefined && <p role="status" className="mt-2 text-xs text-confidence-mid">No separate group Take grant is saved; group Take stays blocked until the host reviews it here.</p>}
                  </fieldset>}
                  {isHost && <>
                    <Button size="sm" variant="outline" aria-label={device.paused ? `Give control back to ${device.name}` : `Take back control from ${device.name}`} aria-pressed={device.paused === true} onClick={() => void setDeskControl(device.hash, device.paused !== true)}>{device.paused ? "Give control back" : "Take back control"}</Button>
                    <Button size="sm" variant="ghost" className="text-destructive" aria-label={`Revoke ${device.name}`} onClick={() => void useSettingsStore.getState().revokeRemoteDevice(device.hash)}>Revoke</Button>
                  </>}
                </li>)}
              </ul>
            )}
            <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">Roles limit each paired device. Pausing leaves its view and team notices available. Revoking removes its saved key. Listener ports, network binding and authentication keys remain in Settings → Remote control.</p>
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer text-muted-foreground">What each role can do</summary>
              <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
                {REMOTE_ROLES.map((role) => <Fragment key={role.id}><dt className="font-semibold">{role.name}</dt><dd className="text-muted-foreground">{role.may}</dd></Fragment>)}
              </dl>
            </details>
          </div>
        </section>
      </div>
    </div>
  )
}
