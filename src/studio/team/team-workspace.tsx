import { FolderSyncIcon, MessageSquareIcon, NetworkIcon, SmartphoneIcon, UsersIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { commentDeleted } from "@/lib/comments"
import { useQueueStore } from "@/stores"
import { openSettings } from "@/lib/settings-dialog"
import { DeskNameSummary } from "@/studio/shell/desk-menu"
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

/** Who is at the desk, the team's comments, and the ways a team works together. Shown on People & access (UX audit slice 7). */
export function TeamSections() {
  const comments = useQueueStore((s) => s.items.reduce((n, i) => n + (i.comments?.filter((c) => !commentDeleted(c)).length ?? 0), 0))
  return (
    <>
      {/* A plain card, like the others (#215): what sharing means, and the two ways to start. */}
      <section aria-label="Working together" className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card p-5 shadow-panel">
        <div className="min-w-0 max-w-2xl">
          <h2 className="text-base font-bold tracking-[-0.03em]">One church, one shared plan</h2>
          <p className="mt-1 text-sm text-muted-foreground">Services are shared through the church folder and approved before Sunday; the team leaves comments on items. Nothing the team edits reaches the live screen without the desk. Everything stays on your computers.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={openChurchFolder}><FolderSyncIcon /> Share through the church folder</Button>
          <Button variant="outline" onClick={() => openConnectionsHub()}><SmartphoneIcon /> Connect a phone or device</Button>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-5 max-[1100px]:grid-cols-1">
        <section aria-label="Operator" className="rounded-lg border border-border bg-card p-5 shadow-panel">
          <h2 className="flex items-center gap-2 text-base font-bold tracking-[-0.03em]"><UsersIcon className="size-4" /> At the desk</h2>
          <p className="mt-2 mb-3 text-xs text-muted-foreground">Your name goes on the service log, on approvals and on your comments, so "who changed this?" has an answer. Stays on this computer.</p>
          <DeskNameSummary id="team-operator-name" />
        </section>

        <section aria-label="Comments" className="rounded-lg border border-border bg-card p-5 shadow-panel">
          <h2 className="flex items-center gap-2 text-base font-bold tracking-[-0.03em]"><MessageSquareIcon className="size-4" /> Comments</h2>
          <p className="mt-2 mb-3 text-xs text-muted-foreground">{comments ? `${comments} comment${comments === 1 ? "" : "s"} on this service's items (Prepare → an item → Notes).` : "No comments on this service's items yet. They are added in Prepare → an item → Notes."}</p>
          <UnreadComments />
        </section>

        <section aria-label="Ways to work together" className="col-span-full rounded-lg border border-border bg-card px-5 pt-5 pb-2 shadow-panel">
          <h2 className="text-base font-bold tracking-[-0.03em]">Ways to work together</h2>
          <ul className="divide-y divide-border">
            <Way icon={<FolderSyncIcon />} title="Church folder" detail="A shared folder (a NAS, or one kept in step by Drive, OneDrive, Dropbox or Syncthing): publish a service, open it on another computer." action={{ label: "Set up", run: openChurchFolder }} />
            <Way icon={<SmartphoneIcon />} title="A phone as a remote" detail="Next, previous and the live status on a phone on the same network (pairing code)." action={{ label: "Open Connections", run: openConnectionsHub }} />
            <Way icon={<NetworkIcon />} title="Host or join a studio on the network" detail="Several computers working on one service at once, each with a role (Bible, timekeeper, screens…), and the team's talk channel." action={{ label: "Open Connections", run: openConnectionsHub }} />
          </ul>
        </section>
      </div>
    </>
  )
}
