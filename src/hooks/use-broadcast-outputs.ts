import { useEffect } from "react"
import { listen } from "@tauri-apps/api/event"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { useBroadcastStore } from "@/stores"
import { disableOutput, enableOutput } from "@/lib/broadcast-output-control"

/** One automatic restart per output per minute; after that the operator decides. */
const lastRestart = new Map<string, number>()
const RESTART_COOLDOWN_MS = 60_000

interface OutputReadyPayload {
  outputId?: string
}

/**
 * Re-sync an output window whenever it reports ready — on first load and after
 * any reload. Mounted app-wide rather than in the broadcast dialog, so a
 * projector that reloads while the dialog is closed still gets its content.
 */
export function useBroadcastOutputs(): void {
  useEffect(() => {
    const timeouts: Array<ReturnType<typeof setTimeout>> = []

    const unlistenPromise = listen<OutputReadyPayload>("broadcast:output-ready", (event) => {
      const store = useBroadcastStore.getState()
      const outputId = event.payload?.outputId
      const outputs = outputId
        ? store.outputs.filter((o) => o.id === outputId)
        : store.outputs

      for (const output of outputs) {
        store.syncBroadcastOutputFor(output.id)
        // Deliberately no ndi-config emit here: the output window queries
        // get_ndi_status itself on mount, which is authoritative. Echoing this
        // side's outputStatus would land later and could stop the frame pump of
        // a sender that is actually live.
        // The window reports ready before its first paint settles.
        timeouts.push(
          setTimeout(() => {
            useBroadcastStore.getState().syncBroadcastOutputFor(output.id)
          }, 150)
        )
      }
    })

    // NDI stream died (frame pushes keep failing): show it, try one restart.
    const unlistenTrouble = listen<{ outputId?: string; message?: string }>("broadcast:ndi-trouble", (event) => {
      const store = useBroadcastStore.getState()
      const id = event.payload?.outputId
      const output = id ? store.outputs.find((o) => o.id === id) : undefined
      // Only an NDI output is ever restarted; a projector window is never touched.
      if (!output || output.type !== "ndi") return
      const message = event.payload?.message?.trim() || "frames are not being sent"
      void (async () => {
      // Stale failures from a sender the operator just turned off are not trouble.
      const status = await invoke<{ active: boolean } | null>("get_ndi_status", { outputId: output.id }).catch(() => null)
      if (!status?.active) {
        store.setNdiError(output.id, null)
        return
      }
      store.setNdiError(output.id, message)
      const last = lastRestart.get(output.id) ?? 0
      if (Date.now() - last < RESTART_COOLDOWN_MS) {
        toast.error(`${output.name}: NDI is not sending`, { description: `${message}. Turn the output off and on in Outputs.` })
        return
      }
      lastRestart.set(output.id, Date.now())
      toast.warning(`${output.name}: NDI stopped sending, restarting it`, { description: message })
      await disableOutput(output)
      const ok = await enableOutput(output)
      if (!ok) toast.error(`${output.name}: NDI could not be restarted`, { description: "Check the NDI runtime and the network, then turn the output on again." })
      })()
    })
    const unlistenRecovered = listen<{ outputId?: string }>("broadcast:ndi-recovered", (event) => {
      const store = useBroadcastStore.getState()
      const id = event.payload?.outputId
      const output = id ? store.outputs.find((o) => o.id === id) : undefined
      if (!output || !store.outputStatus[output.id]?.ndiError) return
      store.setNdiError(output.id, null)
      toast.success(`${output.name}: NDI is sending again`)
    })

    // An output could not play a video (unsupported codec, unreadable file): say so once.
    const unlistenMedia = listen<{ outputId?: string; name?: string }>("broadcast:media-error", (event) => {
      const output = useBroadcastStore.getState().outputs.find((o) => o.id === event.payload?.outputId)
      const message = `${event.payload?.name ?? "The video"} could not play${output ? ` on ${output.name}` : ""}; that screen shows its name instead. Try an MP4 (H.264) file.`
      useBroadcastStore.getState().setPresentWarning(message)
    })

    return () => {
      for (const id of timeouts) clearTimeout(id)
      void unlistenPromise.then((unlisten) => unlisten())
      void unlistenMedia.then((unlisten) => unlisten())
      void unlistenTrouble.then((unlisten) => unlisten())
      void unlistenRecovered.then((unlisten) => unlisten())
    }
  }, [])
}
