import { FolderSyncIcon, MessageSquareIcon, NetworkIcon, ShieldCheckIcon, SmartphoneIcon, UsersIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useQueueStore } from "@/stores"
import { useServiceStore } from "@/stores/service-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useShellStore } from "@/studio/shell-store"
import { approvalState } from "@/lib/approval"
import { UnreadComments } from "@/studio/prepare/unread-comments"
import { openConnectionsHub } from "@/studio/connections/navigation"

function Way({ icon, title, detail, action }: { icon: React.ReactNode; title: string; detail: string; action: { label: string; run: () => void } }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <span aria-hidden className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-kind-other text-kind-other-foreground [&_svg]:size-4">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
      <Button size="sm" variant="outline" onClick={action.run}>{action.label}</Button>
    </li>
  )
}

/** Who is at the desk, approvals, the team's comments, and the ways a team works together. */
export function TeamWorkspace() {
  const operatorName = useSettingsStore((s) => s.operatorName)
  const requireApproval = useSettingsStore((s) => s.requireApproval)
  const current = useServiceStore((s) => s.current)
  const comments = useQueueStore((s) => s.items.reduce((n, i) => n + (i.comments?.length ?? 0), 0))
  const state = current ? approvalState(current) : null
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5 px-8 pt-6 pb-16 max-[1200px]:px-5">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[0.625rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">Plan together · present confidently</p>
            <h1 className="mt-1 text-[1.625rem] leading-tight font-bold tracking-[-0.035em]">Your studio. Your people.</h1>
            <p className="mt-1 text-xs text-muted-foreground">Share the preparation. Keep the live production computer fully in control.</p>
          </div>
          <Button variant="outline" onClick={openConnectionsHub}><NetworkIcon /> Connections</Button>
        </header>
        {/* A plain card, like the others (#215): what sharing means, and the two ways to start. */}
        <section aria-label="Working together" className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card p-5 shadow-panel">
          <div className="min-w-0 max-w-2xl">
            <h2 className="text-base font-bold tracking-[-0.03em]">One church, one shared plan</h2>
            <p className="mt-1 text-sm text-muted-foreground">Services are shared through the church folder and approved before Sunday; the team leaves comments on items. Nothing the team edits reaches the live screen without the desk. Everything stays on your computers.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => useShellStore.getState().goTo("archive")}><FolderSyncIcon /> Share through the church folder</Button>
            <Button variant="outline" onClick={openConnectionsHub}><SmartphoneIcon /> Connect a phone or device</Button>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-5 max-[1100px]:grid-cols-1">
          <section aria-label="Operator" className="rounded-lg border border-border bg-card p-5 shadow-panel">
            <h2 className="flex items-center gap-2 text-base font-bold tracking-[-0.03em]"><UsersIcon className="size-4" /> At the desk</h2>
            <label htmlFor="operator-name" className="mt-3 block text-sm font-medium">Your name</label>
            <p className="mb-2 text-xs text-muted-foreground">Goes on the service log, on approvals and on your comments, so "who changed this?" has an answer. Stays on this computer.</p>
            <Input id="operator-name" value={operatorName} onChange={(e) => useSettingsStore.getState().setOperatorName(e.target.value)} placeholder="e.g. Tolu" className="h-9 max-w-xs" maxLength={60} />
          </section>

          <section aria-label="Approvals" className="rounded-lg border border-border bg-card p-5 shadow-panel">
            <h2 className="flex items-center gap-2 text-base font-bold tracking-[-0.03em]"><ShieldCheckIcon className="size-4" /> Approvals</h2>
            <p className="mt-2 text-sm">
              {!current ? "No saved service is open." : state === "approved" ? <>“{current.title}” is <Badge variant="green">approved</Badge>{current.approved_by ? ` by ${current.approved_by}` : ""}.</> : state === "changed" ? <>“{current.title}” <Badge variant="amber">changed since approval</Badge>.</> : <>“{current.title}” is not approved yet (Prepare → Approve).</>}
            </p>
            <label className="mt-3 flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={requireApproval} onChange={(e) => useSettingsStore.getState().setRequireApproval(e.target.checked)} />
              <span>
                Ask before showing an unapproved service
                <span className="block text-xs text-muted-foreground">When the open service is not approved, or changed after approval, the first Take live asks first. Quick screens and rehearsal are never held. While this is on, a scene change from a joined desk also waits for the main desk to accept it.</span>
              </span>
            </label>
          </section>

          <section aria-label="Comments" className="rounded-lg border border-border bg-card p-5 shadow-panel">
            <h2 className="flex items-center gap-2 text-base font-bold tracking-[-0.03em]"><MessageSquareIcon className="size-4" /> Comments</h2>
            <p className="mt-2 mb-3 text-xs text-muted-foreground">{comments ? `${comments} comment${comments === 1 ? "" : "s"} on this service's items (Prepare → an item → Notes).` : "No comments on this service's items yet. They are added in Prepare → an item → Notes."}</p>
            <UnreadComments />
          </section>

          <section aria-label="Ways to work together" className="rounded-lg border border-border bg-card px-5 pt-5 pb-2 shadow-panel">
            <h2 className="text-base font-bold tracking-[-0.03em]">Ways to work together</h2>
            <ul className="divide-y divide-border">
              <Way icon={<FolderSyncIcon />} title="Church folder" detail="A shared folder (a NAS, or one kept in step by Drive, OneDrive, Dropbox or Syncthing): publish a service, open it on another computer." action={{ label: "Set up", run: () => useShellStore.getState().goTo("archive") }} />
              <Way icon={<SmartphoneIcon />} title="A phone as a remote" detail="Next, previous and the live status on a phone on the same network (pairing code)." action={{ label: "Open Connections", run: openConnectionsHub }} />
              <Way icon={<NetworkIcon />} title="Host or join a studio on the network" detail="Several computers working on one service at once, each with a role (Bible, timekeeper, screens…), and the team's talk channel." action={{ label: "Open Connections", run: openConnectionsHub }} />
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
