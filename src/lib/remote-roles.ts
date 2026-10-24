import type { RemoteRole } from "@/stores/settings-store"

/**
 * What each paired desk may do (Host/Join; #215 G10, #243 VL.5), in plain words for Settings →
 * Remote control and Production → Operators. The host's server checks every command against the
 * same list (src-tauri/crates/api/src/keys.rs `Role::allows`); keep the two in step.
 */
export const REMOTE_ROLES: readonly { id: RemoteRole; name: string; may: string }[] = [
  { id: "timekeeper", name: "Timekeeper", may: "Moves the event clock and the service timer, and holds or resumes the service. Never a screen." },
  { id: "bible", name: "Bible", may: "Activates, steps through and takes off the Bible only." },
  { id: "worship", name: "Worship", may: "Shows or previews songs and hymns from the host's library, and takes the lyrics off and back." },
  { id: "screens", name: "Screens", may: "Takes and releases congregation scenes, and makes or changes scenes. A change to a scene on a screen waits for the main desk." },
  { id: "stage", name: "Stage", may: "Writes, takes off and puts back the stage message. Nothing the congregation sees." },
  { id: "camera", name: "Camera", may: "Answers camera-ready requests, hides a camera from scenes or shows it again, and changes the camera boxes in scenes." },
  { id: "obs", name: "OBS director", may: "Switches OBS scenes through the host's own OBS connection (Preview, Take or switch). Never in rehearsal." },
  { id: "present", name: "Present only", may: "Moves through the service, shows and hides, the Bible, songs, scenes and the event clock. Not settings." },
  { id: "configure", name: "Present and change settings", may: "Everything Present does, plus looks, the on-air switch and making or changing scenes." },
]

/** A saved or announced role, or undefined for one this build does not know. */
export function asRemoteRole(v: unknown): RemoteRole | undefined {
  return REMOTE_ROLES.find((r) => r.id === v)?.id
}

/** A role's short name ("OBS director"), or the role as it is for one this build does not know. */
export function roleLabel(role: string): string {
  const r = REMOTE_ROLES.find((x) => x.id === role)
  return r ? r.name : role
}

/** Whether a desk with this role may make or change scenes (Screens, settings; a camera desk its camera boxes). */
export const editsScenes = (role: string | undefined): boolean => role === "screens" || role === "configure" || role === "camera"
