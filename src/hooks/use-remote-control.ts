import { useEffect } from "react"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { invoke } from "@tauri-apps/api/core"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { pushRemoteKeys, useSettingsStore } from "@/stores/settings-store"
import { REMOTE_EVENTS, REMOTE_PAIR_CLOSED_EVENT, REMOTE_PAIRED_EVENT } from "@/lib/remote-events"
import { toast } from "sonner"
import { runMacro } from "@/lib/cues"
import { useJournalStore } from "@/stores/journal-store"

/** Every remote command lands in the service log, so "who pressed Next?" has an answer (QA-006). */
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
      const register = async (event: string, handler: () => void) => {
        keep(
          await listen(event, () => {
            if (cancelled) return
            noteRemote(event)
            handler()
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

      // remote:paired — a device completed pairing; remember its token hash
      keep(
        await listen<string>(REMOTE_PAIRED_EVENT, (event) => {
          if (cancelled) return
          const p = parsePayload(event.payload)
          if (typeof p?.hash === "string" && typeof p?.name === "string") {
            noteRemote(`${REMOTE_PAIRED_EVENT} ${p.name}`)
            useSettingsStore.getState().addRemoteDevice({ hash: p.hash, name: p.name, role: p.role === "configure" ? "configure" : "present" })
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
          noteRemote(`${REMOTE_EVENTS.macro} ${id}`)
          runMacro(id)
        }
      })
      keep(uMacro)

      // remote:theme — switch active theme by name
      const u3 = await listen<string>(REMOTE_EVENTS.theme, (event) => {
        if (cancelled) return
        noteRemote(REMOTE_EVENTS.theme)
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
        noteRemote(REMOTE_EVENTS.opacity)
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
        noteRemote(REMOTE_EVENTS.on_air)
        const payload = parsePayload(event.payload)
        const active = payload?.active as boolean | undefined
        if (active === undefined) return
        remoteActions.toggleOnAir(active)
      })
      keep(u5)

      // remote:confidence — set detection confidence threshold
      const u8 = await listen<string>(REMOTE_EVENTS.confidence, (event) => {
        if (cancelled) return
        noteRemote(REMOTE_EVENTS.confidence)
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
    liveVerse: broadcast.liveVerse?.reference ?? null,
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
  const { osc, http, oscPort, httpPort, lan } = settings.remoteListeners
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
      await invoke<number>(cmd, { port, lan })
    } catch (e) {
      toast.error(`${label} could not start again`, { description: `${e instanceof Error ? e.message : String(e)}. Start it in Settings → Remote.` })
    }
  }
  if (osc) await start("start_osc", oscPort, "OSC remote control")
  if (http) await start("start_http", httpPort, "Phone and HTTP remote control")
}

