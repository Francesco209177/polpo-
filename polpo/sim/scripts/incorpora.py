#!/usr/bin/env python3
"""Crea il file C++ con i file d'esempio che il firmware vero riceve dal linker (board_build.embed_txtfiles).

    incorpora.py <cartella polpo> <uscita.cpp>

L'elenco viene letto da platformio.ini, così resta uguale a quello del dispositivo.
"""
import re
import sys
from pathlib import Path


def main() -> int:
    polpo, out = Path(sys.argv[1]), Path(sys.argv[2])
    ini = (polpo / "platformio.ini").read_text(encoding="utf-8")
    m = re.search(r"^board_build\.embed_txtfiles\s*=\s*\n((?:[ \t]+\S.*\n)+)", ini, re.M)
    if not m:
        print("incorpora.py: elenco embed_txtfiles non trovato in platformio.ini", file=sys.stderr)
        return 1
    righe = ["// Generato da sim/scripts/incorpora.py: non modificare a mano.", ""]
    for i, percorso in enumerate(p.strip() for p in m.group(1).splitlines() if p.strip()):
        dati = (polpo / percorso).read_bytes()
        simbolo = re.sub(r"[^A-Za-z0-9]", "_", percorso)
        # il linker del dispositivo aggiunge lo zero finale; i byte oltre 127 (lettere accentate) come char con segno
        byte = ", ".join(str(b if b < 128 else b - 256) for b in dati + b"\0")
        righe.append(f'extern const char polpo_incorporato_{i}[] asm("_binary_{simbolo}_start");')
        righe.append(f"const char polpo_incorporato_{i}[] = {{{byte}}};")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(righe) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
