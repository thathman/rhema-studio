import { FolderSyncIcon, MessageSquareIcon, NetworkIcon, ShieldCheckIcon, SmartphoneIcon, UsersIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { commentDeleted } from "@/lib/comments"
import { useQueueStore } from "@/stores"
import { useServiceStore } from "@/stores/service-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useJoin } from "@/stores/join-store"
import { openSettings } from "@/lib/settings-dialog"
import { DeskNameSummary } from "@/studio/shell/desk-menu"
import { openPermissions } from "@/studio/permissions/navigation"
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

/** The church folder is set up in Settings → Data and sync (#814); History holds no folder. */
const openChurchFolder = () => openSettings("data")

/** Who is at the desk, approvals, the team's comments, and the ways a team works together. */
export function TeamWorkspace() {
  const joined = useJoin((s) => s.status !== "off")
  const localRequireApproval = useSettingsStore((s) => s.requireApproval)
  const hostRequireApproval = useJoin((s) => s.live?.requireApproval)
  // A joined desk shows the rule its host applies (Live State), not its own unused local copy.
  const requireApproval = joined ? hostRequireApproval : localRequireApproval
  const current = useServiceStore((s) => s.current)
  const comments = useQueueStore((s) => s.items.reduce((n, i) => n + (i.comments?.filter((c) => !commentDeleted(c)).length ?? 0), 0))
  const state = current ? approvalState(current) : null
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5 px-8 pt-6 pb-16 max-[1200px]:px-5">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow">Plan together · present confidently</p>
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
            <Button onClick={openChurchFolder}><FolderSyncIcon /> Share through the church folder</Button>
            <Button variant="outline" onClick={openConnectionsHub}><SmartphoneIcon /> Connect a phone or device</Button>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-5 max-[1100px]:grid-cols-1">
          <section aria-label="Operator" className="rounded-lg border border-border bg-card p-5 shadow-panel">
            <h2 className="flex items-center gap-2 text-base font-bold tracking-[-0.03em]"><UsersIcon className="size-4" /> At the desk</h2>
            <p className="mt-2 mb-3 text-xs text-muted-foreground">Your name goes on the service log, on approvals and on your comments, so "who changed this?" has an answer. Stays on this computer.</p>
            <DeskNameSummary id="team-operator-name" />
          </section>

          <section aria-label="Approvals" className="rounded-lg border border-border bg-card p-5 shadow-panel">
            <h2 className="flex items-center gap-2 text-base font-bold tracking-[-0.03em]"><ShieldCheckIcon className="size-4" /> Approvals</h2>
            <p className="mt-2 text-sm">
              {!current ? "No saved service is open." : state === "approved" ? <>“{current.title}” is <Badge variant="green">approved</Badge>{current.approved_by ? ` by ${current.approved_by}` : ""}.</> : state === "changed" ? <>“{current.title}” <Badge variant="amber">changed since approval</Badge>.</> : <>“{current.title}” is not approved yet (Prepare → Approve).</>}
            </p>
            {/* The switch itself lives in Permissions (#815); Team says how it is set and links there. */}
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
              <p id="team-approval-policy" className="text-sm">Ask before showing an unapproved service: <span className="font-semibold">{requireApproval === undefined ? "not shared by the main computer yet" : requireApproval ? "on" : "off"}</span>{joined && requireApproval !== undefined ? <span className="text-muted-foreground"> (the main computer’s setting)</span> : null}</p>
              <Button size="sm" variant="outline" aria-describedby="team-approval-policy" onClick={openPermissions}><ShieldCheckIcon /> Change in Permissions</Button>
            </div>
          </section>

          <section aria-label="Comments" className="rounded-lg border border-border bg-card p-5 shadow-panel">
            <h2 className="flex items-center gap-2 text-base font-bold tracking-[-0.03em]"><MessageSquareIcon className="size-4" /> Comments</h2>
            <p className="mt-2 mb-3 text-xs text-muted-foreground">{comments ? `${comments} comment${comments === 1 ? "" : "s"} on this service's items (Prepare → an item → Notes).` : "No comments on this service's items yet. They are added in Prepare → an item → Notes."}</p>
            <UnreadComments />
          </section>

          <section aria-label="Ways to work together" className="rounded-lg border border-border bg-card px-5 pt-5 pb-2 shadow-panel">
            <h2 className="text-base font-bold tracking-[-0.03em]">Ways to work together</h2>
            <ul className="divide-y divide-border">
              <Way icon={<FolderSyncIcon />} title="Church folder" detail="A shared folder (a NAS, or one kept in step by Drive, OneDrive, Dropbox or Syncthing): publish a service, open it on another computer." action={{ label: "Set up", run: openChurchFolder }} />
              <Way icon={<SmartphoneIcon />} title="A phone as a remote" detail="Next, previous and the live status on a phone on the same network (pairing code)." action={{ label: "Open Connections", run: openConnectionsHub }} />
              <Way icon={<NetworkIcon />} title="Host or join a studio on the network" detail="Several computers working on one service at once, each with a role (Bible, timekeeper, screens…), and the team's talk channel." action={{ label: "Open Connections", run: openConnectionsHub }} />
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
