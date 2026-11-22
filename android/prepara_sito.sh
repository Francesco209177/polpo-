#!/usr/bin/env bash
# Prepara le pagine che vanno dentro l'app: il sito del Polpo costruito per il telefono, in app/build/sito.
#
#   android/prepara_sito.sh [cartella con polpo-sim.wasm e licenze/]
#
# Senza argomento compila prima il firmware per il browser (polpo/sim/scripts/compila_web.sh), che scarica da sé
# il compilatore la prima volta. Serve Python con il pacchetto «markdown» (pip install markdown==3.11.3).
set -euo pipefail
QUI="$(cd "$(dirname "$0")" && pwd)"
RADICE="$(cd "$QUI/.." && pwd)"
PYTHON="${PYTHON:-python3}"

if [ $# -ge 1 ]; then
  FIRMWARE="$(cd "$1" && pwd)"
else
  FIRMWARE="$QUI/build/firmware-web"
  "$RADICE/polpo/sim/scripts/compila_web.sh" "$FIRMWARE" "${EMSCRIPTEN_DIR:-$QUI/build/emscripten}"
fi

"$PYTHON" "$RADICE/site/build.py" --app --check --out "$QUI/app/build/sito" --firmware-web "$FIRMWARE"
