#!/usr/bin/env bash
# Build del AUv2 (DrumReplacer.component) y validación con auval.
# Uso: scripts/build-au.sh [Debug|Release]   (default: Debug)
#
# No requiere Xcode completo: con CMake + Command Line Tools alcanza.
# Si Xcode está instalado, usa el generador Xcode; si no, Unix Makefiles.
set -euo pipefail

cd "$(dirname "$0")/../engine/DrumReplacer"

CONFIG="${1:-Debug}"
TARGET="TriggerUniverse-au"

CMAKE_BIN="$(command -v cmake || true)"
if [ -z "$CMAKE_BIN" ] && [ -x /Applications/CMake.app/Contents/bin/cmake ]; then
  CMAKE_BIN="/Applications/CMake.app/Contents/bin/cmake"
fi
if [ -z "$CMAKE_BIN" ]; then
  echo "ERROR: falta CMake (3.14+). Instalalo desde https://cmake.org/download/" >&2
  exit 1
fi

if xcodebuild -version >/dev/null 2>&1; then
  echo "==> Xcode detectado: generador Xcode ($CONFIG)"
  BUILD_DIR="build-xcode"
  "$CMAKE_BIN" -B "$BUILD_DIR" -G Xcode
  "$CMAKE_BIN" --build "$BUILD_DIR" --config "$CONFIG" --target "$TARGET"
  BUILT="$BUILD_DIR/out/$CONFIG/TriggerUniverse.component"
else
  echo "==> Xcode no disponible: Command Line Tools + Unix Makefiles ($CONFIG)"
  BUILD_DIR="build-clt"
  "$CMAKE_BIN" -B "$BUILD_DIR" -G "Unix Makefiles" -DCMAKE_BUILD_TYPE="$CONFIG"
  "$CMAKE_BIN" --build "$BUILD_DIR" --target "$TARGET" -j "$(sysctl -n hw.ncpu)"
  BUILT="$BUILD_DIR/out/TriggerUniverse.component"
fi

echo "==> Reinstalando el componente"
# Xcode firma después del deploy automático de iPlug2, así que reinstalamos
# la copia final (firmada) del build output.
DST="$HOME/Library/Audio/Plug-Ins/Components/TriggerUniverse.component"
if [ -d "$BUILT" ]; then
  rm -rf "$DST"
  cp -R "$BUILT" "$DST"
fi
killall -9 AudioComponentRegistrar 2>/dev/null || true

echo "==> Validando con auval"
auval -v aumf TRGU DANT

echo
echo "OK. El AU quedó en:"
echo "  $HOME/Library/Audio/Plug-Ins/Components/TriggerUniverse.component"
echo "Abrilo desde GarageBand, Logic, Ableton o Reaper."
