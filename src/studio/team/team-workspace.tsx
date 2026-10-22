import { FolderSyncIcon, MessageSquareIcon, NetworkIcon, ShieldCheckIcon, SmartphoneIcon, UsersIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useQueueStore } from "@/stores"
import { useServiceStore } from "@/stores/service-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useShellStore } from "@/studio/shell-store"
import { openSettings } from "@/lib/settings-dialog"
import { approvalState } from "@/lib/approval"
import { UnreadComments } from "@/studio/prepare/unread-comments"

function Way({ icon, title, detail, action, planned }: { icon: React.ReactNode; title: string; detail: string; action?: { label: string; run: () => void }; planned?: string }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <span aria-hidden className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-kind-other text-kind-other-foreground [&_svg]:size-4">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
      {planned ? <Badge variant="neutral">Planned · {planned}</Badge> : action ? <Button size="sm" variant="outline" onClick={action.run}>{action.label}</Button> : null}
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
        <section className="dark rounded-xl bg-sidebar px-8 py-7 text-sidebar-foreground">
          <p className="text-[0.6875rem] font-extrabold tracking-[0.15em] text-sidebar-primary uppercase">Your team</p>
          <h1 className="mt-1 text-[1.75rem] leading-tight font-bold tracking-[-0.04em] text-white">Your studio. Your people.</h1>
          <p className="mt-1 max-w-2xl text-sm">One church, one plan: services are shared through the church folder, approved before Sunday, and the team leaves comments on items. Everything stays on your computers.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => useShellStore.getState().goTo("archive")}><FolderSyncIcon /> Share through the church folder</Button>
            <Button variant="outline" className="border-white/20 bg-white/5 text-white hover:bg-white/10" onClick={() => openSettings("remote")}><SmartphoneIcon /> Use a phone as a remote</Button>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-5 max-[1100px]:grid-cols-1">
          <section aria-label="Operator" className="rounded-xl border border-border bg-card p-5 shadow-panel">
            <h2 className="flex items-center gap-2 text-base font-bold tracking-[-0.03em]"><UsersIcon className="size-4" /> At the desk</h2>
            <label htmlFor="operator-name" className="mt-3 block text-sm font-medium">Your name</label>
            <p className="mb-2 text-xs text-muted-foreground">Goes on the service log, on approvals and on your comments, so "who changed this?" has an answer. Stays on this computer.</p>
            <Input id="operator-name" value={operatorName} onChange={(e) => useSettingsStore.getState().setOperatorName(e.target.value)} placeholder="e.g. Tolu" className="h-9 max-w-xs" maxLength={60} />
          </section>

          <section aria-label="Approvals" className="rounded-xl border border-border bg-card p-5 shadow-panel">
            <h2 className="flex items-center gap-2 text-base font-bold tracking-[-0.03em]"><ShieldCheckIcon className="size-4" /> Approvals</h2>
            <p className="mt-2 text-sm">
              {!current ? "No saved service is open." : state === "approved" ? <>“{current.title}” is <Badge variant="green">approved</Badge>{current.approved_by ? ` by ${current.approved_by}` : ""}.</> : state === "changed" ? <>“{current.title}” <Badge variant="amber">changed since approval</Badge>.</> : <>“{current.title}” is not approved yet (Prepare → Approve).</>}
            </p>
            <label className="mt-3 flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={requireApproval} onChange={(e) => useSettingsStore.getState().setRequireApproval(e.target.checked)} />
              <span>
                Ask before showing an unapproved service
                <span className="block text-xs text-muted-foreground">When the open service is not approved, or changed after approval, the first Show live asks first. Quick screens and rehearsal are never held.</span>
              </span>
            </label>
          </section>

          <section aria-label="Comments" className="rounded-xl border border-border bg-card p-5 shadow-panel">
            <h2 className="flex items-center gap-2 text-base font-bold tracking-[-0.03em]"><MessageSquareIcon className="size-4" /> Comments</h2>
            <p className="mt-2 mb-3 text-xs text-muted-foreground">{comments ? `${comments} comment${comments === 1 ? "" : "s"} on this service's items (Prepare → an item → Notes & team).` : "No comments on this service's items yet. They are added in Prepare → an item → Notes & team."}</p>
            <UnreadComments />
          </section>

          <section aria-label="Ways to work together" className="rounded-xl border border-border bg-card px-5 pt-5 pb-2 shadow-panel">
            <h2 className="text-base font-bold tracking-[-0.03em]">Ways to work together</h2>
            <ul className="divide-y divide-border">
              <Way icon={<FolderSyncIcon />} title="Church folder" detail="A shared folder (a NAS, or one kept in step by Drive, OneDrive, Dropbox or Syncthing): publish a service, open it on another computer." action={{ label: "Set up", run: () => useShellStore.getState().goTo("archive") }} />
              <Way icon={<SmartphoneIcon />} title="A phone as a remote" detail="Next, previous and the live status on a phone on the same network (pairing code)." action={{ label: "Settings", run: () => openSettings("remote") }} />
              <Way icon={<NetworkIcon />} title="Host or join a studio on the network" detail="Several computers working on one service at once, each with a role." planned="#162" />
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
