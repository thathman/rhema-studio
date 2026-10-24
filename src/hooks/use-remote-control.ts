import { useTimerStore } from "@/stores/timer-store"
import { useServiceOffset } from "@/stores/service-offset-store"
import { useHold } from "@/stores/hold-store"
import { useEffect } from "react"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { invoke } from "@tauri-apps/api/core"
import { actingAs, useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { pushRemoteKeys, useSettingsStore } from "@/stores/settings-store"
import { REMOTE_EVENTS, REMOTE_PAIR_CLOSED_EVENT, REMOTE_PAIRED_EVENT } from "@/lib/remote-events"
import { toast } from "sonner"
import { runMacro } from "@/lib/cues"
import { useJournalStore } from "@/stores/journal-store"
import { useEventClock } from "@/stores/event-clock-store"
import { activateBibleReference, previewBibleReference } from "@/lib/bible-activate"
import { songRequest } from "@/lib/song-request"
import { cameraSourceId, isStateSource, type AnySourceId } from "@/lib/live-sources"
import { useNotices } from "@/stores/notices-store"

/** Every remote command lands in the service log, so "who pressed Next?" has an answer (QA-006). */
/** A note in the service log that is not a remote command (a device paired). */
const noteRemote = (event: string) => useJournalStore.getState().add({ kind: "remote", label: event.replace("remote:", "") })
import { remoteActions } from "@/lib/remote-actions"
import { confidenceLevel } from "@/lib/confidence"
import { useApprovalGateStore } from "@/stores/approval-gate-store"

/**
 * Listens for remote control events from the Rust backend (OSC / HTTP API)
 * and dispatches them to the appropriate Zustand stores.
 *
 * Mount this hook once at the app root level.
 */
export function useRemoteControl() {
  // Listeners left running start again with the app (after the keys are in place), so a phone
  // or Stream Deck keeps working after a restart, with the same ports and network choice.
  useEffect(() => {
    void restartRemoteListeners()
  }, [])
  useEffect(() => {
    let cancelled = false
    const unlisteners: UnlistenFn[] = []

    async function setup() {
      // A listener that resolves after cleanup would leak for the process lifetime.
      const keep = (unlisten: UnlistenFn) => {
        if (cancelled) unlisten()
        else unlisteners.push(unlisten)
      }
      keep(
        // Every remote command, with who sent it, as the host carried it out (#246 C17).
        await listen<string>("remote:audit", (e) => {
          if (cancelled) return
          try {
            const p = JSON.parse(e.payload) as { command?: unknown; by?: unknown }
            if (typeof p.command === "string") useJournalStore.getState().add({ kind: "remote", label: `${p.command.slice(0, 120)}${typeof p.by === "string" && p.by ? ` · by ${p.by.slice(0, 60)}` : ""}` })
          } catch {
            // ignore
          }
        }),
      )
      // Each command is carried out for whoever sent it, so a source it activates says "by" them.
      const register = async (event: string, handler: () => void) => {
        keep(
          await listen<string>(event, (e) => {
            if (cancelled) return
            actingAs(senderOf(parsePayload(e.payload)), handler)
          }),
        )
      }

      await register(REMOTE_EVENTS.next, remoteActions.queueNext)
      await register(REMOTE_EVENTS.prev, remoteActions.queuePrev)
      await register(REMOTE_EVENTS.send_to_live, () => void remoteActions.sendToLive())
      await register(REMOTE_EVENTS.add_to_queue, remoteActions.addToQueue)
      await register(REMOTE_EVENTS.bible_next, remoteActions.bibleNext)
      await register(REMOTE_EVENTS.bible_prev, remoteActions.biblePrev)
      await register(REMOTE_EVENTS.verse_next, remoteActions.verseNext)
      await register(REMOTE_EVENTS.verse_prev, remoteActions.versePrev)
      await register(REMOTE_EVENTS.show, () => remoteActions.toggleOnAir(true))
      await register(REMOTE_EVENTS.hide, () => remoteActions.toggleOnAir(false))
      // The event clock (C03): a timekeeper on another computer or a Stream Deck; never a screen.
      await register(REMOTE_EVENTS.event_next, () => useEventClock.getState().next())
      await register(REMOTE_EVENTS.event_prev, () => useEventClock.getState().previous())
      keep(
        await listen<string>(REMOTE_EVENTS.event_start, (event) => {
          if (cancelled) return
          const id = parsePayload(event.payload)?.id
          if (typeof id !== "string") return
          useEventClock.getState().start(id)
        }),
      )
      // Running late or early, from a joined Timekeeper desk or a Stream Deck (#196): logged with who.
      keep(
        await listen<string>(REMOTE_EVENTS.event_offset, (event) => {
          if (cancelled) return
          const p = parsePayload(event.payload)
          if (typeof p?.minutes !== "number") return
          useServiceOffset.getState().adjust(p.minutes, typeof p.by === "string" ? p.by : undefined)
        }),
      )
      // The service timer from a Timekeeper desk (#196 R5), each in the log with who: starting and
      // pausing are logged by the timer's live source (as the desk's), a correction here.
      const byOf = (p: Record<string, unknown> | null | undefined) => (typeof p?.by === "string" && p.by ? `${p.by}: ` : "")
      for (const [event, run] of [
        [REMOTE_EVENTS.timer_start, (p) => { if (useTimerStore.getState().timer.startedAt !== null) return; actingAs(senderOf(p ?? null), () => useTimerStore.getState().start()) }],
        [REMOTE_EVENTS.timer_pause, (p) => { if (useTimerStore.getState().timer.startedAt === null) return; actingAs(senderOf(p ?? null), () => useTimerStore.getState().pause()) }],
        [REMOTE_EVENTS.timer_adjust, (p) => {
          const m = typeof p?.minutes === "number" ? Math.trunc(p.minutes) : 0
          if (!m) return
          useTimerStore.getState().adjustMinutes(m)
          useJournalStore.getState().add({ kind: "timing", label: `${byOf(p)}timer corrected by ${m > 0 ? "+" : "−"}${Math.abs(m)} min` })
        }],
        // A hold from a joined desk (#196 R3): as the main desk's Hold, with who in the log line.
        [REMOTE_EVENTS.hold, (p) => useHold.getState().start(typeof p?.reason === "string" ? p.reason : "", senderOf(p ?? null))],
        [REMOTE_EVENTS.resume, (p) => useHold.getState().resume(senderOf(p ?? null))],
      ] as const satisfies ReadonlyArray<readonly [string, (p: Record<string, unknown> | null | undefined) => void]>) {
        keep(await listen<string>(event, (e) => { if (!cancelled) run(parsePayload(e.payload)) }))
      }
      // Delegated operators (Host/Join): the Bible source, any source's take-off, congregation scenes.
      const withPayload = async (event: string, handler: (p: Record<string, unknown>) => void) => {
        keep(
          await listen<string>(event, (e) => {
            if (cancelled) return
            const p = parsePayload(e.payload)
            if (!p) return
            actingAs(senderOf(p), () => handler(p))
          }),
        )
      }
      // Content sources, the ticker, the timer (take off = pause) and each camera added in Production → Cameras.
      const SOURCES = ["bible", "song", "hymn", "slide", "picture", "ticker", "timer"] as const
      const asSource = (v: unknown): AnySourceId | undefined =>
        SOURCES.find((s) => s === v) ?? (typeof v === "string" && isStateSource(v) && useSettingsStore.getState().cameras.some((c) => cameraSourceId(c.name) === v) ? v : undefined)
      await withPayload(REMOTE_EVENTS.bible_activate, (p) => { if (typeof p.reference === "string") void activateBibleReference(p.reference.slice(0, 120)) })
      // An action request answered on a joined desk (Comms C2): a verse to Preview only, or a song or
      // hymn by title. What could not be done is said here, where the operator can act on it.
      const notDone = (p: Record<string, unknown>, what: string, why: string) => toast.warning(`${what} not shown`, { description: `${byOf(p)}${why}` })
      await withPayload(REMOTE_EVENTS.bible_preview, (p) => {
        if (typeof p.reference !== "string") return
        const ref = p.reference.slice(0, 120)
        void previewBibleReference(ref).then((r) => { if (r !== "previewed") notDone(p, ref, r === null ? "that is not a Bible reference" : "that verse was not found") })
      })
      for (const [event, mode] of [[REMOTE_EVENTS.song_show, "show"], [REMOTE_EVENTS.song_preview, "preview"]] as const) {
        await withPayload(event, (p) => {
          if (typeof p.title !== "string") return
          const title = p.title.slice(0, 120)
          void songRequest(title, mode).then((why) => { if (why) notDone(p, title, why) })
        })
      }
      await withPayload(REMOTE_EVENTS.clear_source, (p) => { const id = asSource(p.id); if (id) useBroadcastStore.getState().clearSource(id) })
      await withPayload(REMOTE_EVENTS.restore_source, (p) => { const id = asSource(p.id); if (id) useBroadcastStore.getState().restoreSource(id) })
      await withPayload(REMOTE_EVENTS.take_scene, (p) => {
        const b = useBroadcastStore.getState()
        const output = b.outputs.find((o) => o.id === p.output && (o.role ?? "congregation") === "congregation")
        if (output && typeof p.scene === "string") b.takeScene(output.id, p.scene)
      })
      // Production notices (Rhema Comms): who sent it (name and key id) comes from the host's server, not the message.
      keep(
        await listen<string>(REMOTE_EVENTS.notice_send, (e) => {
          if (cancelled) return
          const p = parsePayload(e.payload)
          if (!p || typeof p.text !== "string" || typeof p.by !== "string") return
          const items = useQueueStore.getState().items
          const ev = typeof p.event === "string" ? items.find((i) => i.id === p.event) : undefined
          useNotices.getState().send({ from: p.by, ...(typeof p.byId === "string" && p.byId ? { fromId: p.byId } : {}), to: p.to ?? "all", priority: typeof p.priority === "string" ? p.priority : "normal", text: p.text, event: ev ? { id: ev.id, title: ev.reference } : null, action: p.action })
        }),
      )
      keep(
        await listen<string>(REMOTE_EVENTS.notice_ack, (e) => {
          if (cancelled) return
          const p = parsePayload(e.payload)
          if (p && typeof p.id === "string" && typeof p.state === "string" && typeof p.by === "string") useNotices.getState().answer(p.id, p.by, p.state)
        }),
      )
      await withPayload(REMOTE_EVENTS.release_scene, (p) => { if (typeof p.output === "string") useBroadcastStore.getState().releaseScene(p.output) })

      // remote:paired — a device completed pairing; remember its token hash
      keep(
        await listen<string>(REMOTE_PAIRED_EVENT, (event) => {
          if (cancelled) return
          const p = parsePayload(event.payload)
          if (typeof p?.hash === "string" && typeof p?.name === "string") {
            noteRemote(`${REMOTE_PAIRED_EVENT} ${p.name}`)
            useSettingsStore.getState().addRemoteDevice({ hash: p.hash, name: p.name, role: p.role === "configure" || p.role === "timekeeper" || p.role === "bible" || p.role === "screens" ? p.role : "present" })
            toast.success(`${p.name} paired`, { description: "It can now send commands. Revoke it in Settings → Remote." })
          }
        }),
      )

      // remote:pair_closed — the backend closed the pairing window (paired, expired or three wrong codes)
      keep(
        await listen<string>(REMOTE_PAIR_CLOSED_EVENT, () => {
          if (cancelled) return
          window.dispatchEvent(new CustomEvent("rhema:pair-closed"))
        }),
      )

      // remote:macro — run a named macro (Start the service, Offering, …)
      const uMacro = await listen<string>(REMOTE_EVENTS.macro, (event) => {
        if (cancelled) return
        const id = parsePayload(event.payload)?.id
        if (typeof id === "string") {
          actingAs(senderOf(parsePayload(event.payload)), () => runMacro(id))
        }
      })
      keep(uMacro)

      // remote:theme — switch active theme by name
      const u3 = await listen<string>(REMOTE_EVENTS.theme, (event) => {
        if (cancelled) return
        const payload = parsePayload(event.payload)
        const name = payload?.name as string | undefined
        if (!name) return

        const { themes } = useBroadcastStore.getState()
        const theme = themes.find(
          (t) => t.name.toLowerCase() === name.toLowerCase()
        )
        if (theme) {
          useBroadcastStore.getState().setActiveTheme(theme.id)
        }
      })
      keep(u3)

      // remote:opacity — set broadcast output opacity
      const u4 = await listen<string>(REMOTE_EVENTS.opacity, (event) => {
        if (cancelled) return
        const payload = parsePayload(event.payload)
        const value = payload?.value as number | undefined
        if (value === undefined) return
        // Opacity is stored on the live verse rendering; for now broadcast
        // store doesn't have a dedicated opacity field — this is a placeholder
        // that can be wired when the broadcast store adds opacity support.
        void value
      })
      keep(u4)

      // remote:on_air — toggle live broadcast state
      const u5 = await listen<string>(REMOTE_EVENTS.on_air, (event) => {
        if (cancelled) return
        const payload = parsePayload(event.payload)
        const active = payload?.active as boolean | undefined
        if (active === undefined) return
        actingAs(senderOf(payload), () => remoteActions.toggleOnAir(active))
      })
      keep(u5)

      // remote:confidence — set detection confidence threshold
      const u8 = await listen<string>(REMOTE_EVENTS.confidence, (event) => {
        if (cancelled) return
        const payload = parsePayload(event.payload)
        const value = payload?.value as number | undefined
        if (value === undefined) return
        useSettingsStore.getState().setConfidenceThreshold(confidenceLevel(value))
      })
      keep(u8)
    }

    setup()

    // The phone reads GET /api/v1/status: send the snapshot as soon as it changes (store
    // changes, not a timer: a hidden or covered window slows timers to about once a minute),
    // and every few seconds anyway in case the server restarted.
    const unsubscribe = [useBroadcastStore, useQueueStore, useApprovalGateStore, useSettingsStore].map((store) => store.subscribe(() => syncStatusSnapshot()))
    const statusInterval = setInterval(() => {
      syncStatusSnapshot(true)
    }, 5000)

    return () => {
      cancelled = true
      unlisteners.forEach((fn) => fn())
      clearInterval(statusInterval)
      unsubscribe.forEach((u) => u())
    }
  }, [])
}

/**
 * Push current frontend state to the Rust-managed StatusSnapshot.
 */
export function remoteStatusSnapshot() {
  const broadcast = useBroadcastStore.getState()
  const activeTheme = broadcast.themes.find((t) => t.id === broadcast.activeThemeId)
  return {
    onAir: broadcast.isLive,
    activeTheme: activeTheme?.name ?? null,
    // A picture or QR slide has no words of its own: the phone names its rundown item.
    liveVerse: broadcast.liveVerse ? broadcast.liveVerse.reference || broadcast.liveVerse.lines?.[0] || useQueueStore.getState().items.find((i) => i.id === broadcast.liveItemId)?.reference || null : null,
    queueLength: useQueueStore.getState().items.length,
    confidenceThreshold: useSettingsStore.getState().confidenceThreshold,
    rehearsal: broadcast.rehearsal,
    waitingForApproval: useApprovalGateStore.getState().held !== null,
  }
}

let lastSent = ""
/** Send the snapshot when it differs from the last one sent (`force`: send anyway). */
function syncStatusSnapshot(force = false) {
  const snapshot = remoteStatusSnapshot()
  const key = JSON.stringify(snapshot)
  if (!force && key === lastSent) return
  lastSent = key
  invoke("update_remote_status", snapshot).catch(() => {
    // Silently ignore — HTTP server may not be running
  })
}

/** Who sent a remote command: the host adds the paired device's name ("by"); older senders are "a remote". */
function senderOf(p: Record<string, unknown> | null): string {
  return typeof p?.by === "string" && p.by.trim() ? p.by.trim().slice(0, 60) : "a remote"
}

/**
 * Safely parse a JSON string payload from a Tauri event.
 */
function parsePayload(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (typeof raw === "object" && raw !== null) {
    return raw as Record<string, unknown>
  }
  return null
}

export async function restartRemoteListeners(): Promise<void> {
  const settings = useSettingsStore.getState()
  const { osc, http, oscPort, httpPort, lan, https } = settings.remoteListeners
  if (!osc && !http) return
  // Never open the whole network by itself: a listener that accepts other devices starts again
  // only when a key, paired devices or required sign-in protect it (NFR-06).
  const protectedByKey = settings.remoteAuthRequired || settings.remoteSecret.trim().length > 0 || settings.remoteDevices.length > 0
  if (lan && !protectedByKey) {
    toast.warning("Remote control was not started again", {
      description: "It accepted any device on the network with no key. Start it in Settings → Remote, or pair your phone there so it can start by itself.",
      duration: 15_000,
    })
    return
  }
  await pushRemoteKeys()
  const start = async (cmd: "start_osc" | "start_http", port: number, label: string) => {
    try {
      // Already running (the window reloaded; listeners outlive it): nothing to do.
      const status = await invoke<{ running: boolean }>(cmd === "start_osc" ? "get_osc_status" : "get_http_status").catch(() => null)
      if (status?.running) return
      await invoke<number>(cmd, cmd === "start_http" ? { port, lan, https: !!https } : { port, lan })
    } catch (e) {
      toast.error(`${label} could not start again`, { description: `${e instanceof Error ? e.message : String(e)}. Start it in Settings → Remote.` })
    }
  }
  if (osc) await start("start_osc", oscPort, "OSC remote control")
  if (http) await start("start_http", httpPort, "Phone and HTTP remote control")
}

