#!/usr/bin/env bash
# Copia la UI del prototipo al bundle web del plugin.
# El prototipo sigue siendo la fuente de verdad; corré esto antes de build-ear.
set -euo pipefail

cd "$(dirname "$0")/.."
SRC="prototype"
DST="engine/DrumReplacer/resources/web"

for f in index.html style.css app.js native-ui.js; do
  if [ "$f" = "index.html" ]; then
    # WKWebView carga por file:// y los ?v= del prototipo rompen las rutas.
    sed -E 's/\?v=[0-9]+//g' "$SRC/$f" > "$DST/$f"
  else
    cp "$SRC/$f" "$DST/$f"
  fi
  echo "  $SRC/$f -> $DST/$f"
done

echo "UI sincronizada. Ahora: scripts/build-au.sh Debug"
