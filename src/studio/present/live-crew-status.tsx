import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { CircleAlertIcon, UsersRoundIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  presenceRows,
  readHostStatus,
  type HostStatus,
} from "@/lib/host-presence"
import { useSettingsStore } from "@/stores/settings-store"
import { openProductionTab } from "@/studio/production/production-tab"

type CrewSnapshot = {
  deviceKey: string
  host: HostStatus | null
  state: "checking" | "available" | "unavailable"
}

/** A compact entry to the host's authoritative operator presence, without duplicating role controls in Live. */
export function LiveCrewStatus() {
  const devices = useSettingsStore((state) => state.remoteDevices)
  const deviceKey = devices.map((device) => device.hash).join("\u0000")
  const [snapshot, setSnapshot] = useState<CrewSnapshot>({
    deviceKey: "",
    host: null,
    state: "checking",
  })

  useEffect(() => {
    if (!deviceKey) return
    let mounted = true
    let refreshing = false
    const refresh = async () => {
      if (refreshing) return
      refreshing = true
      try {
        const host = readHostStatus(await invoke<unknown>("host_status"))
        if (mounted)
          setSnapshot(
            host
              ? { deviceKey, host, state: "available" }
              : { deviceKey, host: null, state: "unavailable" }
          )
      } catch {
        if (mounted)
          setSnapshot({ deviceKey, host: null, state: "unavailable" })
      } finally {
        refreshing = false
      }
    }
    void refresh()
    const interval = window.setInterval(() => void refresh(), 5000)
    return () => {
      mounted = false
      window.clearInterval(interval)
    }
  }, [deviceKey])

  // Solo-host operation stays clear of an extra status control until there are paired operators.
  if (devices.length === 0) return null

  const { host, state } =
    snapshot.deviceKey === deviceKey
      ? snapshot
      : { host: null, state: "checking" as const }
  const connected = host?.running
    ? presenceRows(devices, host.desks).filter(
        (row) => row.device && row.seen?.connected
      ).length
    : 0
  const status =
    state === "checking"
      ? "Checking"
      : state === "unavailable"
        ? "Unavailable"
        : !host?.running
          ? "Listener off"
          : !host.lan
            ? "Local only"
            : `${connected}/${devices.length} online`

  const accessibleStatus =
    state === "checking"
      ? "checking operator connections"
      : state === "unavailable"
        ? "operator status unavailable"
        : !host?.running
          ? "listener off"
          : !host.lan
            ? "main computer only"
            : `${connected} of ${devices.length} paired operators connected`

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      data-testid="live-crew-status"
      aria-label={`Review paired operators: ${accessibleStatus}`}
      title="Connection status comes from this computer. Open Operators for assigned roles and last-seen details."
      className="h-7 min-w-0 justify-start gap-1.5 px-1.5 text-[0.6875rem]"
      onClick={() => openProductionTab("operators")}
    >
      {state === "unavailable" || (host && (!host.running || !host.lan)) ? (
        <CircleAlertIcon className="size-3.5 text-confidence-mid" />
      ) : (
        <UsersRoundIcon className="size-3.5 text-muted-foreground" />
      )}
      <span className="font-semibold">Crew</span>
      <span className="text-muted-foreground">· {status}</span>
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        Paired operator status: {accessibleStatus}
      </span>
    </Button>
  )
}
