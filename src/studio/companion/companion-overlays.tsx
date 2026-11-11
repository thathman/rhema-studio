import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { LayersIcon, PlusIcon, RefreshCwIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { addOverlayToObs, hostOf, OVERLAY_KINDS, overlayInputs, overlaySize, readFeedLink, testOverlay, updateOverlay, type ObsRequest, type OverlayInput, type OverlayKind, type OverlayTest } from "@/lib/obs-companion"
import { obsRequest, useObsStore } from "@/stores/obs-store"
import { useSettingsStore } from "@/stores/settings-store"

const request = obsRequest as ObsRequest
const field = "h-8 rounded-md border border-input bg-card px-2"

/** The host's feed link is on another computer than the one this Companion joined (a typo, or an old link). */
function otherHost(url: string, joinAddress: string | null | undefined): boolean {
  const link = readFeedLink(url)
  const joined = joinAddress ? hostOf(joinAddress).replace(/^\[|\]$/g, "") : ""
  return !!link && !!joined && link.host.replace(/^\[|\]$/g, "") !== joined
}

/**
 * Rhema's graphics in this OBS (#848 G4): the Bible, lyrics, the name band, the ticker and the
 * timer, each a Browser Source opening one of the host's browser feeds, added to a scene the
 * operator already has. An overlay's link or size can be changed and one can be tested. The
 * operator's own sources are never removed, reordered or hidden, and OBS's program is never changed.
 */
export function Overlays({ Card }: { Card: (p: { title: string; kicker: string; children: React.ReactNode }) => React.ReactNode }) {
  const obsStatus = useObsStore((s) => s.status)
  const scenes = useObsStore((s) => s.scenes)
  const joinAddress = useSettingsStore((s) => s.joinAddress)
  const [list, setList] = useState<OverlayInput[] | null>(null)
  const connected = obsStatus === "connected"
  const reload = useCallback(async () => {
    if (useObsStore.getState().status !== "connected") return
    setList(await overlayInputs(request).catch(() => null))
  }, [])
  // Read again when OBS connects or its scenes change (an overlay may have been added or renamed there).
  useEffect(() => {
    if (!connected) return
    let alive = true
    overlayInputs(request).then((l) => { if (alive) setList(l) }, () => { if (alive) setList(null) })
    return () => { alive = false }
  }, [connected, scenes])
  return (
    <Card kicker="Rhema graphics in this OBS" title="Overlays">
      {!connected ? (
        <p className="text-muted-foreground">Connect to OBS above to add Rhema's overlays to its scenes.</p>
      ) : (
        <>
          <p className="text-muted-foreground">
            Each overlay is a Browser Source showing one of the host's feeds, added on top of a scene you already have. On the host: Outputs → Add a ready-made feed (for example "Rhema Bible | Lower third") as a browser feed, then copy its link for OBS and paste it here. Your own sources in OBS are never removed, moved or hidden.
          </p>
          <AddOverlay scenes={scenes} joinAddress={joinAddress} onDone={reload} />
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">In this OBS</h3>
            <Button size="sm" variant="ghost" onClick={() => void reload()}><RefreshCwIcon /> Refresh</Button>
          </div>
          {list === null ? (
            <p className="text-muted-foreground">OBS's overlays cannot be read right now.</p>
          ) : list.length === 0 ? (
            <p className="text-muted-foreground">No Rhema overlays in this OBS yet.</p>
          ) : (
            <ul aria-label="Overlays in OBS" className="flex flex-col divide-y divide-border rounded-md border border-border">
              {list.map((o) => <OverlayRow key={o.input} overlay={o} scenes={scenes} joinAddress={joinAddress} onDone={reload} />)}
            </ul>
          )}
        </>
      )}
    </Card>
  )
}

function AddOverlay({ scenes, joinAddress, onDone }: { scenes: string[]; joinAddress: string | null | undefined; onDone: () => Promise<void> }) {
  const [kind, setKind] = useState<OverlayKind>("bible")
  const [link, setLink] = useState("")
  const [scene, setScene] = useState("")
  const [width, setWidth] = useState("")
  const [height, setHeight] = useState("")
  const [busy, setBusy] = useState(false)
  const chosen = OVERLAY_KINDS.find((k) => k.id === kind)!
  const target = scenes.includes(scene) ? scene : ""
  const valid = !!readFeedLink(link)
  const add = async () => {
    setBusy(true)
    try {
      const r = await addOverlayToObs(request, { label: chosen.label, url: link, width: overlaySize(width), height: overlaySize(height) }, target)
      toast.success(r.done === "added" ? `${chosen.label} overlay is in "${r.sceneName}"` : r.done === "placed" ? `${chosen.label} overlay is in "${r.sceneName}" too` : `${chosen.label} overlay updated`, { description: `As "${r.inputName}", on top of the scene. Arrange it in OBS as you like.` })
      setLink("")
      await onDone()
    } catch (e) {
      toast.error(`${chosen.label} overlay was not added`, { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <form aria-label="Add an overlay" className="flex flex-col gap-2 rounded-md border border-border p-3" onSubmit={(e) => { e.preventDefault(); void add() }}>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="font-medium">Overlay</span>
          <select aria-label="Overlay" value={kind} onChange={(e) => setKind(e.target.value as OverlayKind)} className={field}>
            {OVERLAY_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">OBS scene</span>
          <select aria-label="OBS scene for the overlay" value={target} onChange={(e) => setScene(e.target.value)} className={`${field} max-w-[220px]`}>
            <option value="">Pick a scene…</option>
            {scenes.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Width</span>
          <input aria-label="Overlay width" inputMode="numeric" placeholder="Canvas" value={width} onChange={(e) => setWidth(e.target.value)} className={`${field} w-20`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Height</span>
          <input aria-label="Overlay height" inputMode="numeric" placeholder="Canvas" value={height} onChange={(e) => setHeight(e.target.value)} className={`${field} w-20`} />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="font-medium">Feed link from the host (meant for "{chosen.feed}")</span>
        <input aria-label="Feed link" placeholder="http://192.168.1.20:8080/feed/…?k=…" value={link} onChange={(e) => setLink(e.target.value)} className={`${field} font-mono`} />
      </label>
      {link.trim() && !valid && <p role="alert" className="font-semibold">That is not a Rhema feed link: it looks like http://host:port/feed/…?k=…</p>}
      {valid && otherHost(link, joinAddress) && <p role="alert" className="font-semibold">This link is for another computer than the host this Companion joined. Check it was copied from the main Rhema Studio computer.</p>}
      <div>
        <Button type="submit" size="sm" disabled={busy || !valid || !target}><PlusIcon /> {busy ? "Adding…" : "Add to the scene"}</Button>
      </div>
    </form>
  )
}

function testWords(t: OverlayTest): string {
  const drawn = t.image ? "OBS draws it" : "OBS gave no picture of it: check the link and that the host is running"
  const shown = t.showing ? "it is showing now" : t.hiddenOnAir ? "it is hidden in a scene that is on air, so it was left hidden" : t.shownBriefly ? "it was shown for a moment in its scene and hidden again" : "it is not on OBS's program or preview now"
  return `${drawn}; ${shown}.`
}

function OverlayRow({ overlay, scenes, joinAddress, onDone }: { overlay: OverlayInput; scenes: string[]; joinAddress: string | null | undefined; onDone: () => Promise<void> }) {
  const [link, setLink] = useState(overlay.url)
  const [width, setWidth] = useState(overlay.width ? String(overlay.width) : "")
  const [height, setHeight] = useState(overlay.height ? String(overlay.height) : "")
  const [scene, setScene] = useState("")
  const [busy, setBusy] = useState<null | "update" | "test" | "place">(null)
  const [tested, setTested] = useState<OverlayTest | null>(null)
  const target = scenes.includes(scene) ? scene : ""
  const changed = link.trim() !== overlay.url || overlaySize(width) !== overlay.width || overlaySize(height) !== overlay.height
  const valid = !!readFeedLink(link)
  const run = async (what: "update" | "test" | "place", work: () => Promise<void>, failed: string) => {
    setBusy(what)
    try {
      await work()
    } catch (e) {
      toast.error(failed, { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }
  const update = () => run("update", async () => {
    await updateOverlay(request, overlay.input, { url: link.trim() === overlay.url ? null : link, width: overlaySize(width), height: overlaySize(height) })
    toast.success(`"${overlay.input}" updated`)
    await onDone()
  }, `"${overlay.input}" was not updated`)
  const test = () => run("test", async () => {
    setTested(null)
    const t = await testOverlay(request, overlay.input, target)
    setTested(t)
    // The picture is shown for a moment, then the row goes back to its words alone.
    if (t.image) setTimeout(() => setTested((now) => (now === t ? { ...t, image: null } : now)), 8000)
  }, `"${overlay.input}" could not be tested`)
  const place = () => run("place", async () => {
    const r = await addOverlayToObs(request, { label: overlay.input, url: overlay.url }, target)
    toast.success(r.done === "placed" ? `"${r.inputName}" is in "${r.sceneName}" too` : `"${r.inputName}" is in "${r.sceneName}" already`)
    await onDone()
  }, `"${overlay.input}" was not added`)
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <LayersIcon aria-hidden className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{overlay.input}</span>
        <span className="text-muted-foreground">{overlay.width && overlay.height ? `${overlay.width}×${overlay.height}` : null}</span>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[240px] flex-1 flex-col gap-1">
          <span className="font-medium">Feed link</span>
          <input aria-label={`Feed link for ${overlay.input}`} value={link} onChange={(e) => setLink(e.target.value)} className={`${field} font-mono`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Width</span>
          <input aria-label={`Width of ${overlay.input}`} inputMode="numeric" value={width} onChange={(e) => setWidth(e.target.value)} className={`${field} w-20`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Height</span>
          <input aria-label={`Height of ${overlay.input}`} inputMode="numeric" value={height} onChange={(e) => setHeight(e.target.value)} className={`${field} w-20`} />
        </label>
        <Button size="sm" variant="outline" disabled={!!busy || !changed || !valid} onClick={() => void update()}>{busy === "update" ? "Updating…" : "Update"}</Button>
      </div>
      {link.trim() && !valid && <p role="alert" className="font-semibold">That is not a Rhema feed link.</p>}
      {valid && otherHost(link, joinAddress) && <p role="alert" className="font-semibold">This link is for another computer than the host this Companion joined.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label={`Scene for ${overlay.input}`} value={target} onChange={(e) => setScene(e.target.value)} className={`${field} max-w-[220px]`}>
          <option value="">Pick a scene…</option>
          {scenes.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Button size="sm" variant="outline" disabled={!!busy || !target} onClick={() => void test()}>{busy === "test" ? "Testing…" : "Test in this scene"}</Button>
        <Button size="sm" variant="ghost" disabled={!!busy || !target} onClick={() => void place()}><PlusIcon /> Add to this scene too</Button>
      </div>
      {tested && (
        <div role="status" className="flex flex-wrap items-center gap-3">
          {tested.image && <img src={tested.image} alt={`OBS's picture of ${overlay.input}`} className="h-[90px] rounded border border-border bg-[repeating-conic-gradient(#8884_0_25%,transparent_0_50%)] bg-[length:16px_16px]" />}
          <p className="min-w-0 flex-1">{testWords(tested)}</p>
        </div>
      )}
    </li>
  )
}
