#!/usr/bin/env bash
# Run Rust type-check + clippy lint on the Tauri crate.
# Use after every fix to catch compile-time errors before invoking `tauri build`.

set -euo pipefail

export PATH="$HOME/.cargo/bin:$PATH"
if ! command -v cargo >/dev/null 2>&1 && command -v powershell.exe >/dev/null 2>&1; then
  WINDOWS_PROFILE="$(
    powershell.exe -NoProfile -Command '[Environment]::GetFolderPath("UserProfile")' | tr -d '\r'
  )"
  if [[ -n "$WINDOWS_PROFILE" ]]; then
    WINDOWS_CARGO_BIN="$(wslpath -u "$WINDOWS_PROFILE")/.cargo/bin"
    export PATH="$WINDOWS_CARGO_BIN:$PATH"
    if command -v cargo.exe >/dev/null 2>&1; then
      cargo() {
        cargo.exe "$@"
      }
    fi
  fi
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="$SCRIPT_DIR/../src-tauri/Cargo.toml"
if command -v cargo.exe >/dev/null 2>&1 && command -v wslpath >/dev/null 2>&1; then
  MANIFEST="$(wslpath -w "$MANIFEST")"
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "error: cargo not found in PATH (looked under \$HOME/.cargo/bin)" >&2
  exit 127
fi

echo "==> cargo check (all targets)"
cargo check --manifest-path "$MANIFEST" --all-targets

echo "==> cargo test"
cargo test --manifest-path "$MANIFEST"

echo "==> cargo clippy (warnings as errors)"
cargo clippy --manifest-path "$MANIFEST" --all-targets -- -D warnings

if cargo fmt --version >/dev/null 2>&1; then
  echo "==> cargo fmt --check (advisory)"
  if ! cargo fmt --manifest-path "$MANIFEST" --check >/dev/null 2>&1; then
    echo "    formatting drift detected; run 'cargo fmt --manifest-path $MANIFEST' to fix"
  fi
fi

echo "==> all rust checks passed"
