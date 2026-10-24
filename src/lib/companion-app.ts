// Rhema Studio Companion (#209), the small app: what its window says about the app itself.

/** Where the companion waits when its window is closed. */
export function trayName(userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent): string {
  return /Mac/i.test(userAgent) ? "the menu bar" : "the notification area (by the clock)"
}
