import { useShellStore } from "@/studio/shell-store"

/** The one front door for network devices and volunteers. */
export function openConnectionsHub(): void {
  useShellStore.getState().goTo("connections")
}
