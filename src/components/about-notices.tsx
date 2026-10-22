import { useEffect, useState } from "react"
import { getVersion } from "@tauri-apps/api/app"

/** The version and the licence notices the app must show (Settings → Help). */
export function AboutNotices() {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(null))
  }, [])
  return (
    <section aria-label="About" className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
      <p className="mb-1 text-sm font-medium text-foreground">
        Rhema Studio {version ? `v${version}` : ""}
      </p>
      <p>
        Built on <span className="text-foreground">Rhema</span> by OpenBezal (MIT licence, © 2025 OpenBezal).
        Rhema Studio keeps the upstream licence and attribution.
      </p>
      <p className="mt-2">
        Yoruba scripture: <span className="text-foreground">Open Yoruba Contemporary Bible</span>, © 2009, 2017 by
        Biblica, Inc., used under CC BY-SA 4.0. The original work by Biblica, Inc. is available for free at
        www.biblica.com and open.bible. The text has been converted to this app's database format; see
        licenses/YORUBA-OYCB-LICENSE.md in the application resources for the changes made. Other translations carry
        their own licences; see the Bible section in Settings and the README.
      </p>
      <p className="mt-2">
        Cross-references from <span className="text-foreground">openbible.info</span>, used under CC BY 4.0.
      </p>
      <p className="mt-2">
        NDI® is a registered trademark of Vizrt NDI AB. The optional NDI runtime is used under the NDI SDK licence; it is not
        part of Rhema's MIT-licensed code. Fonts (Geist, Inter, Source Serif 4) are under the SIL Open Font License 1.1.
        Every open-source component and its licence text: licenses/THIRD-PARTY-NOTICES.md in the application resources;
        the full inventory is in docs/LICENSES.md.
      </p>
    </section>
  )
}
