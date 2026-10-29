import { isBrowserSimulation } from "@/lib/runtime-mode"

/** Distinguishes the mock browser shim from the native host's local-first data and services. */
export function RuntimeSourceBadge() {
  if (isBrowserSimulation()) {
    return (
      <span
        role="status"
        aria-label="SIMULATED · No native host · sample Bible, song, and service data; changes stay in memory"
        title="This browser uses sample KJV/OYCB verses, songs, and services. It is not connected to the native database or outputs; shim-backed changes stay in memory."
        className="inline-flex min-h-8 flex-col justify-center rounded-[5px] bg-tone-amber px-2 text-xs font-bold leading-tight text-tone-amber-foreground"
      >
        <span>SIMULATED</span>
        <span className="font-medium">No native host · sample data</span>
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-[5px] bg-tone-green px-2.5 py-[7px] text-[0.6875rem] font-bold text-tone-green-foreground max-[600px]:hidden" title="Services, songs and Bibles are on this computer: no internet needed on Sunday">
      <span aria-hidden className="size-1.5 rounded-full bg-[#2da78a]" /> Offline-ready
    </span>
  )
}
