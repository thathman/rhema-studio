/**
 * Where a connected device is in the shared Discover › Pair › Assign › Ready path (#445): worked
 * out from what is saved and what the device reports, never assumed. Ready only while the device
 * itself says it works (a TV showing its feed, a camera sending, a desk connected).
 */
export type DeviceStage = "discovered" | "paired" | "assigned" | "ready"

export const DEVICE_STAGES: ReadonlyArray<readonly [DeviceStage, string]> = [
  ["discovered", "Found"],
  ["paired", "Paired"],
  ["assigned", "Assigned"],
  ["ready", "Ready"],
]

/** A device's stage: `paired` it has its own key; `assigned` it has a feed or role; `reporting` it works now. */
export function deviceStage(o: { paired: boolean; assigned: boolean; reporting: boolean }): DeviceStage {
  if (!o.paired) return "discovered"
  if (!o.assigned) return "paired"
  return o.reporting ? "ready" : "assigned"
}

/** What to do next at a stage, said plainly. */
export function nextStep(stage: DeviceStage, kind: "tv" | "camera" | "desk"): string | null {
  if (stage === "ready") return null
  if (stage === "discovered") return kind === "tv" ? "Send it the feed again with the code on the TV, so it has a key of its own" : kind === "camera" ? "Scan its QR code with the phone" : "Pair it with the code"
  if (stage === "paired") return kind === "desk" ? "Give it a role in Permissions" : "Assign it a feed"
  return kind === "tv" ? "Check the TV is on and on the church network" : kind === "camera" ? "Open Rhema Studio Cam on the phone and send" : "Open Rhema Studio on that device"
}
