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
import { ApprovalRequestsPanel } from "./approval-requests-panel"
import { MyApprovalRequests } from "./my-approval-requests"
import { RevokeAction } from "@/studio/connections/revoke-action"
import { TeamSections } from "@/studio/team/team-workspace"

const dateWords = (at: number) => new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })

/** Host-owned access controls and durable scene approvals. Joined desks can inspect, never decide. */
export function PermissionsWorkspace() {
  const joinStatus = useJoin((s) => s.status)
  const joinedMe = useJoin((s) => s.me)
  const requests = useSceneApprovalsStore((s) => s.requests)
  const hydrated = useSceneApprovalsStore((s) => s.hydrated)
  const loadError = useSceneApprovalsStore((s) => s.error)
  const remoteDevices = useSettingsStore((s) => s.remoteDevices)
  const localRequireApproval = useSettingsStore((s) => s.requireApproval)
  const hostRequireApproval = useJoin((s) => s.live?.requireApproval)
  const outputs = useBroadcastStore((s) => s.outputs)
  const congregationOutputs = outputs.filter((output) => (output.role ?? "congregation") === "congregation")
  const stageOutputs = outputs.filter((output) => output.role === "stage")
  const [busy, setBusy] = useState<string | null>(null)
  const [busyRecorderGrant, setBusyRecorderGrant] = useState<string | null>(null)
  const [reloading, setReloading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [recorderGrantErrors, setRecorderGrantErrors] = useState<Record<string, string>>({})
  const isHost = joinStatus === "off"
  // A joined desk shows the rule its host applies (Live State), not its own unused local copy.
  const requireApproval = isHost ? localRequireApproval : hostRequireApproval
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
        const me = useSettingsStore.getState().operatorName.trim() || "Main computer"
        const notice = useNotices.getState().notices.find((item) => item.action?.kind === "sceneEdit" && item.action.value === request.id)
        if (notice) useNotices.getState().answer(notice.id, me, "ready")
      } else {
        if (!await declineSceneRequest(request.id)) throw new Error("The decision could not be saved on this computer.")
        const me = useSettingsStore.getState().operatorName.trim() || "Main computer"
        const notice = useNotices.getState().notices.find((item) => item.action?.kind === "sceneEdit" && item.action.value === request.id)
        if (notice) useNotices.getState().answer(notice.id, me, "unable")
      }
    } catch (error) {
      setErrors((current) => ({ ...current, [request.id]: error instanceof Error ? error.message : String(error) }))
    } finally {
      setBusy(null)
    }
  }

  const setRecorderGrant = async (hash: string, enabled: boolean) => {
    setBusyRecorderGrant(hash)
    setRecorderGrantErrors((current) => ({ ...current, [hash]: "" }))
    try {
      const applied = await useSettingsStore.getState().setRemoteDeviceRecorderGrant(hash, enabled)
      const savedGrant = useSettingsStore.getState().remoteDevices.find((device) => device.hash === hash)?.record === true
      if (!applied && savedGrant !== enabled) throw new Error("The main computer did not confirm the Recorder access change. The saved grant was left unchanged.")
    } catch (error) {
      setRecorderGrantErrors((current) => ({ ...current, [hash]: error instanceof Error ? error.message : String(error) }))
    } finally {
      setBusyRecorderGrant(null)
    }
  }

  // Requests from desks on older versions (no host request ID) belong to the same Approval Requests
  // list (doc 28, #855): open ones first, decided ones folded away, nothing dropped.
  const isOpen = (request: SceneEditApproval) => request.status === "pending" || request.status === "needs-review"
  const openLocal = ordered.filter(isOpen)
  const decidedLocal = ordered.filter((request) => !isOpen(request))
  const localRow = (request: SceneEditApproval) => {
    const status = request.status === "needs-review" ? "Needs a fresh request" : request.status[0].toUpperCase() + request.status.slice(1)
    return (
      <li key={request.id} className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold">{request.scene ? `Change “${request.name}”` : `Delete “${request.name}”`}</h4><Badge variant={request.status === "pending" ? "amber" : request.status === "approved" ? "green" : request.status === "declined" ? "neutral" : "rose"}>{status}</Badge></div>
          <p className="mt-1 text-xs text-muted-foreground">From {request.by} · {dateWords(request.at)}{request.decidedBy ? ` · ${request.status} by ${request.decidedBy}` : ""}</p>
          {request.reason && <p className="mt-1 text-xs text-muted-foreground">{request.reason}</p>}
          {errors[request.id] && <p role="alert" className="mt-2 text-xs text-destructive">{errors[request.id]}</p>}
        </div>
        {isHost && isOpen(request) && <div className="flex gap-2">
          {request.status === "pending" && <Button size="sm" disabled={busy === request.id} onClick={() => void decide(request, "accept")}><CheckIcon /> Accept</Button>}
          <Button size="sm" variant="outline" disabled={busy === request.id} onClick={() => void decide(request, "decline")}><XIcon /> Decline</Button>
        </div>}
      </li>
    )
  }
  const localRequests = ordered.length > 0 || loadError || !hydrated ? {
    open: pending.length,
    content: (
      <div role="group" aria-labelledby="local-requests-title" className="mt-4 border-t border-border pt-3 first:mt-0 first:border-0 first:pt-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="local-requests-title" className="min-w-0 flex-1 text-sm font-semibold">From desks on an older version</h3>
          {loadError && <Button size="sm" variant="outline" disabled={reloading} onClick={() => { setReloading(true); void reloadSceneApprovals().catch(() => {}).finally(() => setReloading(false)) }}><RefreshCwIcon /> Try again</Button>}
        </div>
        <p className="mt-1 mb-3 text-xs text-muted-foreground">These scene requests came without a main computer request ID, so this computer keeps them. Accept saves the scene here and never takes it live.</p>
        {loadError && <p role="alert" className="mb-3 flex items-start gap-2 text-sm text-destructive"><CircleAlertIcon className="mt-0.5 size-4 shrink-0" />These requests could not be loaded: {loadError}</p>}
        {!hydrated && !loadError ? <p role="status" className="text-sm text-muted-foreground">Loading saved requests…</p> : openLocal.length === 0 ? <p className="text-sm text-muted-foreground">None waiting.</p> : <ul className="divide-y divide-border">{openLocal.map(localRow)}</ul>}
        {decidedLocal.length > 0 && <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground">Decided earlier ({decidedLocal.length})</summary>
          <ul className="mt-2 divide-y divide-border">{decidedLocal.map(localRow)}</ul>
        </details>}
      </div>
    ),
  } : undefined

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5 px-8 pt-6 pb-16 max-[1200px]:px-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl leading-tight font-semibold tracking-tight">People &amp; access</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Who works on the service, what joined desks and paired devices may do, and changes waiting for the main computer. Only the main computer can approve or change access.</p>
          </div>
        </header>

        {!isHost && <p role="status" className="rounded-md border border-border bg-muted/40 p-3 text-sm">This joined desk is read-only for approvals and device access. Ask the main computer to make changes.</p>}

        <ApprovalRequestsPanel local={localRequests} />

        <section aria-labelledby="approval-policy-title" className="rounded-lg border border-border bg-card shadow-panel">
          <header className="flex items-center gap-3 border-b border-border bg-surface-elevated px-4 py-3">
            <ShieldCheckIcon aria-hidden className="size-4 text-muted-foreground" />
            <div><h2 id="approval-policy-title" className="font-semibold">Before a service goes live</h2><p className="text-xs text-muted-foreground">The approval rule this computer applies to Take live and to scene changes from joined desks. Approving a service itself happens in Prepare.</p></div>
          </header>
          <div className="p-4">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" aria-describedby="approval-policy-detail" disabled={!isHost} checked={requireApproval === true} onChange={(e) => useSettingsStore.getState().setRequireApproval(e.target.checked)} />
              <span>
                Ask before showing an unapproved service
                <span id="approval-policy-detail" className="block text-xs text-muted-foreground">When the open service is not approved, or changed after approval, the first Take live asks first. Quick screens and rehearsal are never held. While this is on, a scene change from a joined desk also waits for the main computer to accept it.</span>
              </span>
            </label>
            {!isHost && <p role="status" className="mt-2 text-xs text-muted-foreground">{requireApproval === undefined ? "The main computer has not shared this setting yet." : `Shown as the main computer applies it (${requireApproval ? "on" : "off"}). Only the main computer can change it.`}</p>}
          </div>
        </section>

        {isHost ? <section aria-labelledby="paired-access-title" className="rounded-lg border border-border bg-card shadow-panel">
          <header className="flex items-center gap-3 border-b border-border bg-surface-elevated px-4 py-3">
            <KeyRoundIcon aria-hidden className="size-4 text-muted-foreground" />
            <div><h2 id="paired-access-title" className="font-semibold">Paired device access</h2><p className="text-xs text-muted-foreground">Saved pairing records. A device is shown as paired; this list does not claim that it is online now. Individual Screens Takes remain the default. Group Take needs its own main computer grant and an exact target review on the desk.</p></div>
          </header>
          <div className="p-4">
            {remoteDevices.length === 0 ? <p className="text-sm text-muted-foreground">No devices are paired. The studio works on this computer without them.</p> : (
              <ul className="divide-y divide-border">
                {remoteDevices.map((device) => <li key={device.hash} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1"><p className="font-semibold">{device.name}</p><p className="text-xs text-muted-foreground">{roleLabel(device.role ?? "viewer")}{device.role === undefined ? " · needs a role" : ""} · paired {new Date(device.paired_at).toLocaleDateString()} · {device.paused ? "control paused" : "control available"}</p></div>
                  <label className="flex items-center gap-2 text-xs"><span>Role</span><select aria-label={`Role for ${device.name}`} disabled={!isHost} value={device.role ?? "viewer"} onChange={(event) => { const role = asRemoteRole(event.target.value); if (role) void useSettingsStore.getState().setRemoteDeviceRole(device.hash, role) }} className="h-8 max-w-48 rounded-md border border-border bg-background px-2">
                    {REMOTE_ROLES.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                  </select></label>
                  <fieldset className="w-full rounded-md border border-border p-3">
                    <legend className="px-1 text-xs font-semibold">Separate Rhema Recorder grant</legend>
                    <p className="mb-2 text-xs text-muted-foreground">Allows this device to start or stop Rhema-native recording and add markers. This is independent of its role and does not grant OBS recording access.</p>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        aria-label={`Rhema Recorder access for ${device.name}`}
                        disabled={!isHost || busyRecorderGrant === device.hash}
                        checked={device.record === true}
                        onChange={(event) => void setRecorderGrant(device.hash, event.target.checked)}
                      />
                      <span>Allow Rhema recording controls</span>
                    </label>
                    {recorderGrantErrors[device.hash] && <p role="alert" className="mt-2 text-xs text-destructive">{recorderGrantErrors[device.hash]}</p>}
                  </fieldset>
                  {device.role === "screens" && <fieldset className="w-full rounded-md border border-border p-3">
                    <legend className="px-1 text-xs font-semibold">Individual scene Take outputs</legend>
                    {device.outputScope === undefined
                      ? <p role="status" className="mb-2 text-xs text-confidence-mid">Legacy Screens access needs scope review. Scene Takes are blocked until the main computer assigns outputs.</p>
                      : device.outputScope.length === 0
                        ? <p role="status" className="mb-2 text-xs text-muted-foreground">No outputs assigned; scene Takes are blocked.</p>
                        : <p className="mb-2 text-xs text-muted-foreground">Only the selected output can be taken or released from this desk.</p>}
                    {congregationOutputs.length === 0
                      ? <p className="text-xs text-muted-foreground">No congregation outputs are configured on this computer.</p>
                      : <div className="flex flex-wrap gap-x-4 gap-y-2">{congregationOutputs.map((output) => <label key={output.id} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          aria-label={`${output.name} output access for ${device.name}`}
                          disabled={!isHost}
                          checked={device.outputScope?.includes(output.id) ?? false}
                          onChange={(event) => void useSettingsStore.getState().setRemoteDeviceOutputAccess(device.hash, output.id, event.currentTarget.checked)}
                        />
                        <span>{output.name}</span>
                      </label>)}</div>}
                  </fieldset>}
                  {device.role === "stage" && <fieldset className="w-full rounded-md border border-border p-3">
                    <legend className="px-1 text-xs font-semibold">Assigned Stage displays</legend>
                    {device.outputScope === undefined || device.outputScope.length === 0
                      ? <p role="status" className="mb-2 text-xs text-confidence-mid">No Stage display is assigned; targeted messages stay blocked until the main computer assigns one.</p>
                      : <p className="mb-2 text-xs text-muted-foreground">This Stage desk can send a private message to one assigned display at a time. The congregation never sees these messages.</p>}
                    {stageOutputs.length === 0
                      ? <p className="text-xs text-muted-foreground">No Stage displays are configured on this computer.</p>
                      : <div className="flex flex-wrap gap-x-4 gap-y-2">{stageOutputs.map((output) => <label key={output.id} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          aria-label={`${output.name} Stage access for ${device.name}`}
                          disabled={!isHost}
                          checked={device.outputScope?.includes(output.id) ?? false}
                          onChange={(event) => void useSettingsStore.getState().setRemoteDeviceOutputAccess(device.hash, output.id, event.currentTarget.checked)}
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
                          onChange={(event) => void useSettingsStore.getState().setRemoteDeviceGroupTakeAccess(device.hash, output.id, event.currentTarget.checked)}
                        />
                        <span>{output.name}</span>
                      </label>)}</div>}
                    {device.groupTakeScope === undefined && <p role="status" className="mt-2 text-xs text-confidence-mid">No separate group Take grant is saved; group Take stays blocked until the main computer reviews it here.</p>}
                  </fieldset>}
                  {isHost && <>
                    <Button size="sm" variant="outline" aria-label={device.paused ? `Give control back to ${device.name}` : `Take back control from ${device.name}`} aria-pressed={device.paused === true} onClick={() => void setDeskControl(device.hash, device.paused !== true)}>{device.paused ? "Give control back" : "Take back control"}</Button>
                    <RevokeAction label={device.name} what={`${device.name}'s key is removed: it is disconnected now and must pair again. This computer keeps full control.`} onRevoke={() => void useSettingsStore.getState().revokeRemoteDevice(device.hash)} />
                  </>}
                </li>)}
              </ul>
            )}
            <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">Roles limit what each paired device can do. Pause stops its commands but keeps its view and team notices; Revoke removes it until it pairs again. Network ports and keys are in Settings → Network & remote access.</p>
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer text-muted-foreground">What each role can do</summary>
              <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
                {REMOTE_ROLES.map((role) => <Fragment key={role.id}><dt className="font-semibold">{role.name}</dt><dd className="text-muted-foreground">{role.may}</dd></Fragment>)}
              </dl>
            </details>
          </div>
        </section>
        : <>
          <MyApprovalRequests />
          <section aria-labelledby="your-access-title" className="rounded-lg border border-border bg-card shadow-panel">
          <header className="flex items-center gap-3 border-b border-border bg-surface-elevated px-4 py-3">
            <ShieldCheckIcon aria-hidden className="size-4 text-muted-foreground" />
            <div><h2 id="your-access-title" className="font-semibold">Your access</h2><p className="text-xs text-muted-foreground">This view shows only the access the main computer assigned to this desk. Other paired-device names and grants are private to the main computer.</p></div>
          </header>
          <dl className="grid gap-3 p-4 sm:grid-cols-2">
            <div><dt className="text-xs font-semibold text-muted-foreground">This desk</dt><dd className="mt-1 text-sm">{joinedMe?.name ?? "Waiting for main computer confirmation"}</dd></div>
            <div><dt className="text-xs font-semibold text-muted-foreground">Role</dt><dd className="mt-1 text-sm">{joinedMe ? roleLabel(joinedMe.role) : "Not confirmed by the main computer"}</dd></div>
            <div><dt className="text-xs font-semibold text-muted-foreground">{joinedMe?.role === "stage" ? "Assigned Stage displays" : "Individual congregation outputs"}</dt><dd className="mt-1 text-sm">{joinedMe?.outputScope === undefined ? "Not shared in this view" : joinedMe.outputScope.length === 0 ? "None assigned" : `${joinedMe.outputScope.length} assigned`}</dd></div>
            <div><dt className="text-xs font-semibold text-muted-foreground">Group Take outputs</dt><dd className="mt-1 text-sm">{joinedMe?.groupTakeScope === undefined ? "Not shared in this view" : joinedMe.groupTakeScope.length === 0 ? "None assigned" : `${joinedMe.groupTakeScope.length} assigned`}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs font-semibold text-muted-foreground">Rhema Recorder</dt><dd className="mt-1 text-sm text-muted-foreground">The Recorder grant is separate from your role and is managed by the main computer. This joined view does not expose the main computer’s paired-device list.</dd></div>
          </dl>
          </section>
        </>}

        <TeamSections />
      </div>
    </div>
  )
}
