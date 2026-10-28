#!/usr/bin/env bash
# Fetch the camera router (MediaMTX, MIT licence) that ships inside Rhema (#209).
#
# Downloads the pinned release for one Rust target, checks it against the SHA-256 written
# below (never against anything downloaded with it), and places the program where Tauri's
# externalBin expects it: src-tauri/binaries/mediamtx-<target>[.exe]. That folder is not
# committed. A release build then adds it with:
#   bun tauri build --target <target> --config src-tauri/tauri.camera-router.conf.json
#
# Usage: scripts/fetch-mediamtx.sh [target]   (default: this computer's target, from rustc)
set -euo pipefail

VERSION="v1.21.2"

TARGET="${1:-$(rustc -vV 2>/dev/null | sed -n 's/^host: //p')}"
[ -n "$TARGET" ] || { echo "Give a target, e.g. aarch64-apple-darwin" >&2; exit 2; }

# Target -> release asset and its SHA-256 (from the release's checksums.sha256, checked 2026-10-23).
case "$TARGET" in
  x86_64-apple-darwin)       ASSET="darwin_amd64.tar.gz";  SHA="87a00062b6a588aa1158f875504a3b56c80d62e2611dc450b83d0534e1b49198" ;;
  aarch64-apple-darwin)      ASSET="darwin_arm64.tar.gz";  SHA="7d0d0c5c11527cbd10bde1c3d728864eb0334a9b653566cd73c0259750cbf093" ;;
  x86_64-pc-windows-msvc)    ASSET="windows_amd64.zip";    SHA="a84224f5a490855684e62ba6fb71e80ea2a5e16aed61883bb58380290e93e467" ;;
  x86_64-unknown-linux-gnu)  ASSET="linux_amd64.tar.gz";   SHA="121be6e00397e473a95d83c75f4fcd3819a6af3b0e1a50889cba43ab4fab6a27" ;;
  aarch64-unknown-linux-gnu) ASSET="linux_arm64.tar.gz";   SHA="180a235374a548d9133cdd5e20f5dbd8b01317be1c86e0d7e66df585dc42ed6f" ;;
  *) echo "No camera router build for $TARGET" >&2; exit 2 ;;
esac

EXT=""
case "$TARGET" in *windows*) EXT=".exe" ;; esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT/src-tauri/binaries"
OUT="$OUT_DIR/mediamtx-$TARGET$EXT"
FILE="mediamtx_${VERSION}_${ASSET}"
URL="https://github.com/bluenviron/mediamtx/releases/download/$VERSION/$FILE"

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "Fetching MediaMTX $VERSION for $TARGET"
curl -fsSL --retry 3 -o "$WORK/$FILE" "$URL"

GOT="$(sha256 "$WORK/$FILE")"
if [ "$GOT" != "$SHA" ]; then
  echo "Checksum mismatch for $FILE: expected $SHA, got $GOT. Not using it." >&2
  exit 1
fi

mkdir -p "$WORK/x"
case "$ASSET" in
  *.zip)
    if command -v unzip >/dev/null 2>&1; then unzip -q "$WORK/$FILE" -d "$WORK/x"
    else powershell -NoProfile -Command "Expand-Archive -LiteralPath '$WORK/$FILE' -DestinationPath '$WORK/x'"
    fi ;;
  *) tar -xzf "$WORK/$FILE" -C "$WORK/x" ;;
esac

[ -f "$WORK/x/mediamtx$EXT" ] || { echo "mediamtx$EXT not found in $FILE" >&2; exit 1; }
mkdir -p "$OUT_DIR"
cp "$WORK/x/mediamtx$EXT" "$OUT"
chmod 755 "$OUT"
echo "Placed $OUT"
