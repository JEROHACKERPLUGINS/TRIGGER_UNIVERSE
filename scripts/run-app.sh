#!/usr/bin/env bash
# Compila y abre el standalone (misma UI WebView que el AU, sin DAW).
# Requiere Xcode completo por el .xib de la app.
set -euo pipefail

cd "$(dirname "$0")/../engine/DrumReplacer"

CMAKE_BIN="$(command -v cmake || true)"
if [ -z "$CMAKE_BIN" ] && [ -x /Applications/CMake.app/Contents/bin/cmake ]; then
  CMAKE_BIN="/Applications/CMake.app/Contents/bin/cmake"
fi
if [ -z "$CMAKE_BIN" ]; then
  echo "ERROR: falta CMake." >&2
  exit 1
fi

if ! xcodebuild -version >/dev/null 2>&1; then
  echo "ERROR: el standalone necesita Xcode completo (ibtool)." >&2
  exit 1
fi

"$CMAKE_BIN" -B build-xcode -G Xcode
"$CMAKE_BIN" --build build-xcode --config Debug --target TriggerUniverse-app
open build-xcode/out/Debug/TriggerUniverse.app
