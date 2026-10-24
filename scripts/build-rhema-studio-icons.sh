#!/usr/bin/env bash
# Regenerate all native Rhema Studio icons from the OWNER-APPROVED exact R SVG.
# No re-drawing or modifying its vector paths. Requires Bun and Tauri CLI.
set -euo pipefail
cd "$(dirname "$0")/.."
test -s public/rhema.svg || { echo "Missing approved public/rhema.svg" >&2; exit 1; }
if ! grep -q 'M21 15H34.2C42.63 15' public/rhema.svg; then
  echo "Logo differs from the exact owner-approved Rhema Studio R path; aborting." >&2
  exit 1
fi
bunx tauri icon public/rhema.svg --output src-tauri/icons
for asset in icon.ico icon.icns 32x32.png 128x128.png 128x128@2x.png; do
  test -s "src-tauri/icons/$asset" || { echo "Tauri icon missing: $asset" >&2; exit 1; }
done
echo "Generated native icons from exact SVG. Review alpha/16px legibility and test the real Windows and macOS installers before release."
