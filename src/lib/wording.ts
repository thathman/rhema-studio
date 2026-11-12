/**
 * The canonical operator words (#822): one name for each thing on the desktop, joined desks,
 * phones, Rhema Studio Companion and Rhema Studio Cam. Code identifiers keep "host"; people read
 * these. The Rust host and the Android apps say the same words in their own strings.
 */

/** The computer that runs the service (never "main desk" or "the host" in what people read). */
export const MAIN_COMPUTER = "main computer"
export const MAIN_COMPUTER_NAME = "Main computer"

/** Leaving a paired main computer, from a joined desk or the Companion. */
export const LEAVE_MAIN_COMPUTER = "Leave this main computer"

/** Content off the screens and back: the transport bar's words, everywhere. */
export const CLEAR = "Clear"
export const RESTORE = "Restore"

/** A different action: a camera taken out of every scene that uses it, and put back in them. */
export const HIDE_CAMERA = "Hide camera"
export const SHOW_CAMERA = "Show camera"

/** The tally: on air, naming where; OBS's program is the screen called "OBS". */
export const OBS_SCREEN = "OBS"
export const OFF_AIR = "OFF AIR"
export const onAir = (screens: readonly string[]): string => `ON AIR · ${screens.join(", ")}`

/** Where things are, by the menus' exact labels. */
export const PAIR_PATH = "Connections → Pair a device"
export const REMOTE_SETTINGS_PATH = "Settings → Remote Control"
