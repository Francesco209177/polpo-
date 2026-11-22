#!/usr/bin/env python3
"""Scarica le tre librerie che servono al simulatore, nelle versioni fissate in platformio.ini.

    librerie.py [cartella di destinazione]     (predefinita: polpo/.pio/libdeps/cardputer)

Serve dove non si compila il firmware per il Cardputer (per esempio nella pubblicazione del sito): «pio run» le
scarica già tutte, insieme alla catena di compilazione dell'ESP32, che qui non serve.
"""
import re
import subprocess
import sys
from pathlib import Path

SERVONO = ("M5GFX", "ArduinoJson", "rc-switch")


def main() -> int:
    polpo = Path(__file__).resolve().parents[2]
    dest = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else polpo / ".pio/libdeps/cardputer"
    ini = (polpo / "platformio.ini").read_text(encoding="utf-8")
    m = re.search(r"^\[env:cardputer\]\n(.*?)(?=^\[)", ini, re.M | re.S)
    blocco = re.search(r"^lib_deps\s*=\s*\n((?:[ \t]+\S.*\n)+)", m.group(1) if m else "", re.M)
    if not blocco:
        print("librerie.py: lib_deps di [env:cardputer] non trovato in platformio.ini", file=sys.stderr)
        return 1
    voci = [v.strip() for v in blocco.group(1).splitlines() if v.strip()]
    scelte = [v for v in voci if v.split("/")[-1].split("@")[0] in SERVONO]
    if len(scelte) != len(SERVONO) or not all("@" in v for v in scelte):
        print(f"librerie.py: in platformio.ini mi aspettavo {', '.join(SERVONO)} con la versione, trovo {scelte}", file=sys.stderr)
        return 1
    mancanti = [v for v in scelte if not (dest / v.split("/")[-1].split("@")[0]).is_dir()]
    if not mancanti:
        print("librerie.py: già presenti in", dest)
        return 0
    dest.mkdir(parents=True, exist_ok=True)
    comando = ["pio", "pkg", "install", "--storage-dir", str(dest)]
    for v in mancanti:
        comando += ["--library", v]
    print("librerie.py:", " ".join(mancanti))
    return subprocess.call(comando)


if __name__ == "__main__":
    raise SystemExit(main())
