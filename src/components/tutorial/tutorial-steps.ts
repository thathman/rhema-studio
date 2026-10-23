import type { Step } from "react-joyride"
import type { Workspace } from "@/studio/shell-store"

/** Where a step lives: the tour opens that workspace (and Present view) before showing it. */
export interface TourPlace {
  workspace: Workspace
  presentView?: "standard" | "production"
}

const STEP_DEFAULTS = {
  skipBeacon: true,
} as const satisfies Partial<Step>

const at = (place: TourPlace, step: Omit<Step, "data">): Step => ({ ...STEP_DEFAULTS, ...step, data: place })

/**
 * The first-run tour of Rhema Studio: the four workspaces in the order a
 * volunteer uses them on a Sunday (check, prepare, present, adjust).
 */
export const TUTORIAL_STEPS: Step[] = [
  at({ workspace: "home" }, {
    target: 'nav[aria-label="Workspaces"]',
    title: "Your studio",
    content: "Home checks you are ready. Prepare builds the service. Present runs it. Production keeps time and watches the screens. Under Your church: the library, the design of your screens, your team and past services. Settings is at the bottom.",
    placement: "right",
  }),
  at({ workspace: "home" }, {
    target: 'section[aria-labelledby="readiness"]',
    title: "Ready to present?",
    content: "Before the service, Home lists anything that needs attention (screens off, missing files, an unapproved service), each with a button that takes you to the fix.",
    placement: "right",
  }),
  at({ workspace: "home" }, {
    target: 'section[aria-labelledby="quick"]',
    title: "Screens",
    content: "Outputs turns on the projector, the stage screen and NDI streams. Nothing reaches them until you show it live.",
    placement: "left",
  }),
  at({ workspace: "prepare" }, {
    target: '[data-tour="service-bar"]',
    title: "Your service",
    content: "Create, open and save a service here. Every save is kept, so you can go back to an earlier version.",
    placement: "bottom",
  }),
  at({ workspace: "prepare" }, {
    target: '[data-tour="prepare-add"]',
    title: "Add to the service",
    content: "Add item opens passages, songs (in one or two languages), hymns, slides, pictures, videos and sound. Nothing in Prepare goes live.",
    placement: "bottom",
  }),
  at({ workspace: "prepare" }, {
    target: '[data-tour="prepare-rundown"]',
    title: "The running order",
    content: "Drag to reorder. Select an item to edit it beside the list: what it shows, notes for the team and its planned minutes.",
    placement: "right",
  }),
  at({ workspace: "present", presentView: "standard" }, {
    target: '[data-tour="present-rundown"]',
    title: "Run the service",
    content: "Click an item to preview it; double-click to show it live.",
    placement: "right",
  }),
  at({ workspace: "present", presentView: "standard" }, {
    target: '[data-studio-live]',
    title: "What people see",
    content: "Live is exactly what is on the screens. The preview beside it is what comes next, for you only.",
    placement: "left",
  }),
  at({ workspace: "present", presentView: "standard" }, {
    target: '[role="toolbar"][aria-label="Presentation controls"]',
    title: "Next, Clear, Restore",
    content: "Next and Previous step through slides and items (arrow keys or a clicker work too). Clear (Esc) takes the screen off; Restore brings it back.",
    placement: "top",
  }),
  at({ workspace: "present", presentView: "standard" }, {
    target: '[data-tour="quick-find"]',
    title: "Find anything",
    content: "Type a reference (\"John 3 16\", \"Johanu 3:16\"), a hymn number (\"245\") or a few words. Enter previews it; it is not live yet.",
    placement: "top",
  }),
  at({ workspace: "present", presentView: "standard" }, {
    target: '[role="group"][aria-label="Quick screens"]',
    title: "Quick screens",
    content: "Welcome, Please stand, Let us pray, Black and more, at once. Back returns to what was live.",
    placement: "left",
  }),
  at({ workspace: "present", presentView: "standard" }, {
    target: '[role="group"][aria-label="Present view"]',
    title: "Listening for verses",
    content: "The Advanced view adds listening: Rhema hears the preacher and proposes the verses mentioned. Standard is the simple view for running a service; the service itself is built in Prepare.",
    placement: "bottom",
  }),
  at({ workspace: "production" }, {
    target: '[role="tablist"][aria-label="Production"]',
    title: "Production control",
    content: "The service clock, holds and other timers; every screen and NDI sender and whether it is on; and the readiness checks before Sunday. Nothing here takes anything live.",
    placement: "bottom",
  }),
  at({ workspace: "production" }, {
    target: 'nav[aria-label="Workspaces"]',
    title: "Library, Design, Team and Archive",
    content: "Songs, pictures and backups live in the Library. Design sets how everything looks (each language of a bilingual screen can be styled on its own). Settings, at the bottom, has Bible translations, audio and remotes, and can restart this tour.",
    placement: "right",
  }),
]
