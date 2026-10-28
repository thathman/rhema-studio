#!/usr/bin/env bash
# Make a locally built Rhema.app self-contained on macOS (Intel QA builds).
#
# A build linked against Homebrew's ONNX Runtime (ORT_PREFER_DYNAMIC_LINK=1)
# loads /usr/local/opt/... at launch, which another Mac may not have. This
# copies every non-system library the executable needs (recursively) into
# Contents/Frameworks, points the load commands there, re-signs the bundle
# ad hoc ("-", as tauri.conf.json does) and optionally makes a .dmg.
#
# Usage: scripts/macos-bundle-dylibs.sh path/to/Rhema.app [out.dmg]
set -euo pipefail
APP="$1"; DMG="${2:-}"
EXE="$APP/Contents/MacOS/$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Contents/Info.plist")"
FW="$APP/Contents/Frameworks"; mkdir -p "$FW"

# Libraries outside the OS: Homebrew (/usr/local, /opt/homebrew) and @rpath ones we cannot resolve.
deps() { otool -L "$1" | tail -n +2 | awk '{print $1}' | grep -E '^(/usr/local|/opt/homebrew)/' || true; }

queue=("$EXE"); seen=" "
while [ ${#queue[@]} -gt 0 ]; do
  bin="${queue[0]}"; queue=("${queue[@]:1}")
  for dep in $(deps "$bin"); do
    name="$(basename "$dep")"
    if [[ "$seen" != *" $name "* ]]; then
      seen+="$name "
      cp -L "$dep" "$FW/$name"; chmod u+w "$FW/$name"
      install_name_tool -id "@rpath/$name" "$FW/$name"
      queue+=("$FW/$name")
    fi
    install_name_tool -change "$dep" "@rpath/$name" "$bin"
  done
done
otool -l "$EXE" | grep -q "@executable_path/../Frameworks" || install_name_tool -add_rpath "@executable_path/../Frameworks" "$EXE"
for lib in "$FW"/*.dylib; do
  [ -e "$lib" ] || continue
  otool -l "$lib" | grep -q "@loader_path" || install_name_tool -add_rpath "@loader_path" "$lib" 2>/dev/null || true
done

# Anything still pointing outside the bundle and the OS is a packaging failure.
leftover=$( { otool -L "$EXE"; for lib in "$FW"/*.dylib; do [ -e "$lib" ] && otool -L "$lib"; done; } | grep -E '^\s+(/usr/local|/opt/homebrew)/' || true)
[ -z "$leftover" ] || { echo "still linked outside the bundle:"; echo "$leftover"; exit 1; }

codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"
echo "bundled: $(ls "$FW" | tr '\n' ' ')"

if [ -n "$DMG" ]; then
  rm -f "$DMG"
  stage="$(mktemp -d)"; cp -R "$APP" "$stage/"; ln -s /Applications "$stage/Applications"
  hdiutil create -volname "Rhema (Intel)" -srcfolder "$stage" -ov -format UDZO "$DMG" >/dev/null
  rm -rf "$stage"
  echo "dmg: $DMG"
fi
