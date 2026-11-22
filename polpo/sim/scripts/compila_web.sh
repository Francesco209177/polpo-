#!/usr/bin/env bash
# Compila il firmware vero in WebAssembly e lo mette in <uscita>/polpo-sim.wasm.
#
#   polpo/sim/scripts/compila_web.sh <uscita> [cartella di Emscripten]
#
# Fa tutto da sé: scarica le librerie fissate in platformio.ini e il compilatore (se mancano), compila.
set -euo pipefail
QUI="$(cd "$(dirname "$0")" && pwd)"
USCITA="$(mkdir -p "${1:?indica la cartella di uscita}" && cd "$1" && pwd)"
EMSCRIPTEN="${2:-${TMPDIR:-/tmp}/polpo-emscripten}"

python3 "$QUI/librerie.py"
"$QUI/emscripten.sh" "$EMSCRIPTEN"
# shellcheck disable=SC1091
source "$EMSCRIPTEN/ambiente.sh"
emcmake cmake -S "$QUI/.." -B "$USCITA/costruzione" -G Ninja -DCMAKE_BUILD_TYPE=MinSizeRel
cmake --build "$USCITA/costruzione"
cp "$USCITA/costruzione/polpo-sim.wasm" "$USCITA/polpo-sim.wasm"

# Il modulo contiene codice di altre librerie: le loro licenze viaggiano con lui.
LIB="$QUI/../../.pio/libdeps/cardputer"
mkdir -p "$USCITA/licenze"
cp "$LIB/M5GFX/LICENSE" "$USCITA/licenze/M5GFX.txt"
cp "$LIB/M5GFX/src/lgfx/Fonts/efont/COPYRIGHT.txt" "$USCITA/licenze/efont.txt"
cp "$LIB/ArduinoJson/LICENSE.txt" "$USCITA/licenze/ArduinoJson.txt"
awk '/^\/\*/{dentro=1} dentro{print} /\*\//{exit}' "$LIB/rc-switch/RCSwitch.cpp" > "$USCITA/licenze/rc-switch.txt"
cp "$QUI/../../../LICENSE" "$USCITA/licenze/Polpo.txt"
cat > "$USCITA/licenze/LEGGIMI.txt" <<'TESTO'
Il file polpo-sim.wasm è il firmware del Polpo compilato per il browser. Contiene:

- il firmware e il simulatore del Polpo (licenza MIT, vedi Polpo.txt);
- M5GFX con il motore grafico LovyanGFX (vedi M5GFX.txt) e i caratteri efont (vedi efont.txt);
- ArduinoJson (licenza MIT, vedi ArduinoJson.txt);
- rc-switch (GNU LGPL 2.1 o successiva, vedi rc-switch.txt).

Il codice sorgente di tutto, con le istruzioni per ricompilare il file, è nel repository del progetto
(cartella polpo/sim); le versioni delle librerie sono fissate in polpo/platformio.ini.
TESTO
ls -l "$USCITA/polpo-sim.wasm" "$USCITA/licenze"
