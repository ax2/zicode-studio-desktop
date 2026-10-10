#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script must run on macOS."
  exit 1
fi

cd "$ROOT_DIR"

case "$(uname -m)" in
  arm64) EXPECTED_PI_TARGET="darwin-arm64"; RUST_TARGET="aarch64-apple-darwin" ;;
  x86_64) EXPECTED_PI_TARGET="darwin-x64"; RUST_TARGET="x86_64-apple-darwin" ;;
  *) echo "Unsupported Mac architecture for this DMG entry."; exit 1 ;;
esac
if [[ -n "${PI_TARGET_PLATFORM:-}" && "$PI_TARGET_PLATFORM" != "$EXPECTED_PI_TARGET" ]]; then
  echo "PI_TARGET_PLATFORM must match this Mac's architecture ($EXPECTED_PI_TARGET)."
  exit 1
fi

RELEASE_DIR="release"
if [[ -n "${CARGO_BUILD_TARGET:-}" ]]; then
  if [[ "$CARGO_BUILD_TARGET" != "$RUST_TARGET" ]]; then
    echo "CARGO_BUILD_TARGET must match this Mac's architecture ($RUST_TARGET)."
    exit 1
  fi
  RELEASE_DIR="$CARGO_BUILD_TARGET/release"
fi

if [[ -n "${CARGO_TARGET_DIR:-}" && "$CARGO_TARGET_DIR" == /* ]]; then
  BUNDLE_DIRS=("$CARGO_TARGET_DIR/$RELEASE_DIR/bundle/dmg")
elif [[ -n "${CARGO_TARGET_DIR:-}" ]]; then
  BUNDLE_DIRS=(
    "$ROOT_DIR/$CARGO_TARGET_DIR/$RELEASE_DIR/bundle/dmg"
    "$ROOT_DIR/src-tauri/$CARGO_TARGET_DIR/$RELEASE_DIR/bundle/dmg"
  )
else
  BUNDLE_DIRS=(
    "$ROOT_DIR/target/$RELEASE_DIR/bundle/dmg"
    "$ROOT_DIR/src-tauri/target/$RELEASE_DIR/bundle/dmg"
  )
fi
BUILD_STARTED_AT="$(mktemp)"
trap 'rm -f "$BUILD_STARTED_AT"' EXIT

echo "Building macOS DMG with the project build entry..."
bun run build

shopt -s nullglob
DMG_PATH=""
for bundle_dir in "${BUNDLE_DIRS[@]}"; do
  for candidate in "$bundle_dir"/*.dmg; do
    if [[ "$candidate" -nt "$BUILD_STARTED_AT" && ( -z "$DMG_PATH" || "$candidate" -nt "$DMG_PATH" ) ]]; then
      DMG_PATH="$candidate"
    fi
  done
done
if [[ -z "$DMG_PATH" ]]; then
  echo "No DMG produced by this build under any expected bundle directory."
  exit 1
fi

echo "Done! DMG is at: $DMG_PATH"
