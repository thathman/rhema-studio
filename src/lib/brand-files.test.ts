import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { MAINTAINER, PRODUCT_NAMES, UPSTREAM_CREDIT } from "@/lib/brand"

// The owner's final logo pack is copied byte for byte; platform files point back to its manifest.
const root = process.cwd()
const read = (p: string) => readFileSync(join(root, p))
const sha = (p: string) => createHash("sha256").update(read(p)).digest("hex")
const manifest: Record<string, string> = JSON.parse(read("brand/ASSET-MANIFEST.json").toString()).asset_sha256

function files(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((f) => (statSync(join(root, dir, f)).isDirectory() ? files(`${dir}/${f}`) : [`${dir}/${f}`]))
}

describe("brand files (owner's pack)", () => {
  it("every file in brand/ is the pack's own, by its manifest hash", () => {
    const ours = files("brand").filter((f) => !["brand/README.md", "brand/ASSET-MANIFEST.json"].includes(f))
    const packPath = (f: string) => f === "brand/ASSET-README.md" ? "README.md" : f.slice("brand/".length)
    expect(ours.map(packPath).sort()).toEqual(Object.keys(manifest).sort())
    for (const f of ours) expect(sha(f), f).toBe(manifest[packPath(f)])
  })

  it("each platform icon is the same bytes as its pack file", () => {
    const copies: [string, string][] = [
      ["src-tauri/icons/32x32.png", "brand/01_Master_Mark/Rhema-Studio-Mark-32.png"],
      ["src-tauri/icons/64x64.png", "brand/01_Master_Mark/Rhema-Studio-Mark-64.png"],
      ["src-tauri/icons/128x128.png", "brand/01_Master_Mark/Rhema-Studio-Mark-128.png"],
      ["src-tauri/icons/128x128@2x.png", "brand/01_Master_Mark/Rhema-Studio-Mark-256.png"],
      ["src-tauri/icons/icon.png", "brand/01_Master_Mark/Rhema-Studio-Mark-512.png"],
      ["src-tauri/icons/icon.icns", "brand/04_Launcher_Icons/Rhema-Studio-macOS.icns"],
      ["src-tauri/icons/icon.ico", "brand/04_Launcher_Icons/Rhema-Studio-Windows.ico"],
      ["companion-app/src-tauri/icons/32x32.png", "brand/01_Master_Mark/Rhema-Studio-Mark-32.png"],
      ["companion-app/src-tauri/icons/128x128.png", "brand/01_Master_Mark/Rhema-Studio-Mark-128.png"],
      ["companion-app/src-tauri/icons/128x128@2x.png", "brand/01_Master_Mark/Rhema-Studio-Mark-256.png"],
      ["companion-app/src-tauri/icons/512x512.png", "brand/04_Launcher_Icons/Rhema-Studio-Android-512.png"],
      ["companion-app/src-tauri/icons/icon.icns", "brand/04_Launcher_Icons/Rhema-Studio-macOS.icns"],
      ["companion-app/src-tauri/icons/icon.ico", "brand/04_Launcher_Icons/Rhema-Studio-Windows.ico"],
      ["public/rhema.svg", "brand/01_Master_Mark/Rhema-Studio-Master-Mark.svg"],
      ["android-tv/res/drawable-xhdpi/banner.png", "brand/03_Google_TV/Rhema-Studio-Receiver-Google-TV-Dark-320x180.png"],
      ["android-tv/res/drawable-nodpi/icon.png", "brand/04_Launcher_Icons/Rhema-Studio-Android-512.png"],
      ["android-tv/res/drawable-nodpi/receiver_logo.png", "brand/02_Product_Logos/Rhema-Studio-Receiver-Light-Text.png"],
      ["android-camera/res/drawable-nodpi/ic_launcher_fg.png", "brand/04_Launcher_Icons/Rhema-Studio-Android-Adaptive-Foreground-432.png"],
      ["android-camera/res/drawable-nodpi/ic_launcher_bg.png", "brand/04_Launcher_Icons/Rhema-Studio-Android-Adaptive-Background-432.png"],
      ["android-camera/res/drawable-nodpi/cam_wordmark.png", "brand/02_Product_Logos/Rhema-Studio-Cam-Light-Text.png"],
    ]
    for (const [copy, source] of copies) expect(sha(copy), copy).toBe(sha(source))
  })

  it("the phone pages carry the reversed mark exactly as drawn", () => {
    const light = read("brand/01_Master_Mark/Rhema-Studio-Mark-Light.svg").toString().trim()
    const paths = light.match(/<path[^>]*\/>/g) ?? []
    expect(paths.length).toBe(4)
    for (const page of ["src-tauri/crates/api/src/remote.html", "src-tauri/crates/api/src/camera.html"]) {
      const html = read(page).toString()
      for (const p of paths) expect(html, page).toContain(p)
      expect(html).toContain("<title>Rhema Studio")
    }
  })

  it("the Studio loading screen uses the official light and dark wordmarks", () => {
    const html = read("index.html").toString()
    expect(html).toContain("/brand/02_Product_Logos/Rhema-Studio-Dark-Text.png")
    expect(html).toContain("/brand/02_Product_Logos/Rhema-Studio-Light-Text.png")
  })

  it("the apps are named as the family", () => {
    expect(read("android-tv/AndroidManifest.xml").toString()).toContain(`android:label="${PRODUCT_NAMES.receiver}"`)
    expect(read("android-camera/AndroidManifest.xml").toString()).toContain(`android:label="${PRODUCT_NAMES.cam}"`)
    // Identifiers do not move: installed apps update in place and saved settings load.
    expect(read("android-tv/AndroidManifest.xml").toString()).toContain('package="com.openbezal.rhema.receiver"')
    expect(read("android-camera/AndroidManifest.xml").toString()).toContain('package="com.openbezal.rhema.camera"')
    const conf = JSON.parse(read("src-tauri/tauri.conf.json").toString())
    expect(conf.identifier).toBe("com.openbezal.rhema")
    expect(conf.productName).toBe("Rhema")
    expect(conf.bundle.macOS.bundleName).toBe(PRODUCT_NAMES.studio)
    expect(read("android-camera/res/mipmap-anydpi-v26/ic_launcher.xml").toString()).toContain('@drawable/ic_launcher_bg')
    expect(read("android-camera/res/mipmap-anydpi-v26/ic_launcher.xml").toString()).toContain('@drawable/ic_launcher_fg')
  })
})

describe("the original licence and credit (MIT)", () => {
  it("LICENSE is GPL-3.0-or-later and still carries OpenBezal's copyright and the MIT text word for word", () => {
    const license = read("LICENSE").toString()
    expect(license).toContain("either version 3 of the\nLicense, or (at your option) any later version.")
    expect(license).toContain("GNU GENERAL PUBLIC LICENSE")
    expect(license).toContain("MIT License\n\nCopyright (c) 2025 OpenBezal")
    expect(license).toContain("The above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.")
    expect(license).toContain('THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND')
    expect(read("data/INSTALLER-LICENSE.txt").toString()).toContain("Copyright (c) 2025 OpenBezal")
  })

  it("names the maintainers and keeps the upstream credit", () => {
    expect(MAINTAINER).toBe("Rhema Studio contributors")
    expect(UPSTREAM_CREDIT).toBe("Built on Rhema by OpenBezal (MIT licence, © 2025 OpenBezal).")
  })
})
