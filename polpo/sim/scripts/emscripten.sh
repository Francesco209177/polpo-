#!/usr/bin/env bash
# Scarica Emscripten (il compilatore per WebAssembly) nella versione fissata qui sotto e ne prepara la configurazione.
#
#   polpo/sim/scripts/emscripten.sh <cartella>      poi:   source <cartella>/ambiente.sh
#
# Si scarica l'archivio ufficiale dei file già compilati (lo stesso che usa «emsdk») e se ne controlla l'impronta.
# Servono: curl, tar con xz, Python 3 e Node.js (già presenti sui computer di GitHub Actions).
set -euo pipefail

VERSIONE="7.0.1"
COMMIT="9146b21a8350e85c9934cf570f7a6ceb7470623b"
SHA256="aebab2ffa9b758d56db9e41adfacb0bf00f95800970c64f5e6a0ae7631066b5c"

DEST="$(mkdir -p "${1:?indica la cartella di destinazione}" && cd "$1" && pwd)"
if [ ! -x "$DEST/install/emscripten/emcc" ]; then
  echo "Emscripten $VERSIONE: scarico in $DEST"
  curl -sS --fail --retry 3 -o "$DEST/emscripten.tar.xz" \
    "https://storage.googleapis.com/webassembly/emscripten-releases-builds/linux/$COMMIT/wasm-binaries.tar.xz"
  echo "$SHA256  $DEST/emscripten.tar.xz" | sha256sum --check --quiet
  tar -xJf "$DEST/emscripten.tar.xz" -C "$DEST"
  rm "$DEST/emscripten.tar.xz"
fi
cat > "$DEST/config" <<CONFIG
LLVM_ROOT = '$DEST/install/bin'
BINARYEN_ROOT = '$DEST/install'
EMSCRIPTEN_ROOT = '$DEST/install/emscripten'
NODE_JS = '$(command -v node)'
CONFIG
cat > "$DEST/ambiente.sh" <<AMBIENTE
export EM_CONFIG='$DEST/config'
export EM_CACHE='$DEST/cache'
export PATH='$DEST/install/emscripten':"\$PATH"
AMBIENTE
echo "Emscripten $VERSIONE pronto: source $DEST/ambiente.sh"
