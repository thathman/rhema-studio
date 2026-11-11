/**
 * A screen's feed page keeps the script it first loaded: when Rhema Studio is updated and comes
 * back, the page reconnects but still runs the old build (a TV keeps it for days). The page the
 * host serves now names its build's script by hash; a different name means the page is out of date.
 */

/** The feed script the page's HTML loads (`feed-<hash>.js`), or null when it names none. */
export function feedScriptName(html: string): string | null {
  return html.match(/\/assets\/(feed-[\w-]+\.js)["'?]/)?.[1] ?? null
}

/** Whether the host now serves another build than the one running (`ownScriptUrl`: import.meta.url). */
export function feedPageOutdated(html: string, ownScriptUrl: string): boolean {
  const served = feedScriptName(html)
  const own = ownScriptUrl.split(/[?#]/)[0].split("/").pop()
  // A page run from source (dev server) or HTML without the script says nothing: never reload on a guess.
  return served !== null && !!own && /^feed-[\w-]+\.js$/.test(own) && served !== own
}
