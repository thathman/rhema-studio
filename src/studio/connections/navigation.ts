import { useShellStore } from "@/studio/shell-store"

/** The one front door for network devices and volunteers; `at` scrolls to a card once the page is up. */
export function openConnectionsHub(at?: "obs"): void {
  useShellStore.getState().goTo("connections")
  if (at) setTimeout(() => document.getElementById(`connections-${at}`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 150)
}
