/** The blocks a joined desk is built from (#813 F2): one set, laid out as the Operators card or as a page. */
export type DeskBlock = "program" | "upcoming" | "director" | "clock" | "prepare" | "bible" | "songs" | "cameras" | "outputs" | "sources" | "scenes" | "stage" | "obs" | "aux" | "runOfShow" | "viewer"

/** The Operators card keeps its order from before the desk pages. */
export const CARD_ORDER: readonly DeskBlock[] = ["program", "upcoming", "director", "clock", "prepare", "bible", "songs", "cameras", "outputs", "sources", "scenes", "stage", "obs", "aux", "runOfShow"]

export interface DeskPage {
  /** The operator page's name (doc 46). */
  title: string
  /** One line: what this desk is for. */
  purpose: string
  /** The work, in reading order. */
  main: readonly DeskBlock[]
  /** Context beside the work; Talk and Notices always close it. */
  side: readonly DeskBlock[]
  /** The work area is wide enough for two columns of blocks. */
  mainColumns?: boolean
  /** The side column reads first (the Editor starts from the running order). */
  sideFirst?: boolean
}

/**
 * Operator pages 2–11 (doc 46, proposals 36–45): each role's own page, built from the same blocks
 * as before. Approval covers the structure, not pixels; the host still checks every command.
 */
export const DESK_PAGES: Record<string, DeskPage> = {
  bible: { title: "Bible operator", purpose: "Prepare Scripture privately, then send it as this desk is allowed.", main: ["bible"], side: ["program", "aux", "runOfShow"] },
  worship: { title: "Worship operator", purpose: "Today's songs: step sections and change the temporary order without rewriting the plan.", main: ["songs"], side: ["program", "aux", "runOfShow"] },
  timekeeper: { title: "Timekeeper", purpose: "The one host clock: start events, adjust, hold and run the extra timers.", main: ["clock"], side: ["program", "aux", "runOfShow"] },
  screens: { title: "Screens & graphics", purpose: "Your named outputs: what each shows, its sources and its scenes, with explicit Take.", main: ["outputs", "sources", "scenes"], side: ["program", "upcoming", "aux", "runOfShow"] },
  stage: { title: "Stage operator", purpose: "Private cues to your assigned Stage display, beside the host clock.", main: ["stage"], side: ["program", "aux", "runOfShow"] },
  camera: { title: "Camera operator", purpose: "Each camera's health and tally, and the camera boxes in scenes.", main: ["cameras", "scenes"], side: ["program", "aux", "runOfShow"] },
  obs: { title: "OBS director", purpose: "OBS Preview and the online Program, with explicit OBS Take. The congregation screens are read only here.", main: ["obs"], side: ["program", "aux", "runOfShow"] },
  editor: { title: "Editor", purpose: "Prepare content and scenes privately; nothing here goes live.", main: ["prepare", "scenes"], side: ["program", "runOfShow", "aux"], sideFirst: true },
  "obs-companion": { title: "OBS companion", purpose: "This computer runs OBS only and sends nothing to the service; follow what is on the screens and the run of show.", main: ["program", "runOfShow"], side: ["aux"] },
  viewer: { title: "Viewer", purpose: "Follow the service: now, next and the clock. No production controls.", main: ["viewer"], side: [] },
  present: { title: "Main presenter", purpose: "The director's board and every desk this role may use.", main: ["director", "program", "outputs", "sources", "scenes", "bible", "songs", "stage"], side: ["clock", "aux", "runOfShow"], mainColumns: true },
  configure: { title: "Configure", purpose: "The director's board and every desk this role may use.", main: ["director", "program", "outputs", "sources", "scenes", "bible", "songs", "stage"], side: ["clock", "aux", "runOfShow"], mainColumns: true },
}

/** A confirmed role without its own page still sees what the Operators card showed it. */
export const FALLBACK_PAGE: DeskPage = { title: "Operator", purpose: "Follow the host's service as your role allows.", main: ["program", "runOfShow"], side: ["aux"] }

/** The page for this role: View only for the viewer, the fallback for any other role without one. */
export function deskPageFor(role: string): DeskPage {
  return DESK_PAGES[role] ?? (role === "viewer" ? DESK_PAGES.viewer! : FALLBACK_PAGE)
}
