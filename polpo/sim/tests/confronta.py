#!/usr/bin/env python3
"""Esegue un copione sul firmware simulato e confronta ciò che esce con il risultato atteso.

    confronta.py <polpo_host> <prova.copione>            confronta con prova.atteso
    confronta.py <polpo_host> <prova.copione> --aggiorna  riscrive prova.atteso (dopo aver controllato le schermate!)
    confronta.py <polpo_host> <prova.copione> --immagini <cartella>   salva anche le schermate (.ppm)

Una riga «---» nel copione spegne e riaccende il Polpo (un nuovo processo): serve a provare ciò che deve
sopravvivere allo spegnimento. «{TMP}» diventa una cartella temporanea comune alle parti.
"""
import difflib
import os
import subprocess
import sys
import tempfile
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    host, copione = sys.argv[1], Path(sys.argv[2])
    aggiorna = "--aggiorna" in sys.argv
    immagini = sys.argv[sys.argv.index("--immagini") + 1] if "--immagini" in sys.argv else None
    atteso = copione.with_suffix(".atteso")
    ambiente = dict(os.environ, ASAN_OPTIONS="detect_leaks=0:abort_on_error=1", UBSAN_OPTIONS="halt_on_error=1:print_stacktrace=1")
    uscita = []
    with tempfile.TemporaryDirectory(prefix="polpo-sim-") as tmp:
        parti = copione.read_text(encoding="utf-8").replace("{TMP}", tmp).split("\n---\n")
        for i, parte in enumerate(parti):
            file = Path(tmp) / f"parte{i}.copione"
            file.write_text(parte, encoding="utf-8")
            if i:
                uscita.append("--- riavvio")
            r = subprocess.run([host, str(file)] + ([immagini] if immagini else []), capture_output=True, text=True, env=ambiente, timeout=120)
            uscita += r.stdout.replace(tmp, "{TMP}").splitlines()
            if r.returncode != 0:
                print(f"{copione.name}: il simulatore è uscito con codice {r.returncode}", file=sys.stderr)
                print(r.stdout[-2000:], r.stderr[-6000:], file=sys.stderr)
                return 1
    testo = "\n".join(uscita) + "\n"
    if aggiorna:
        atteso.write_text(testo, encoding="utf-8")
        print(f"{atteso.name}: aggiornato ({len(uscita)} righe)")
        return 0
    if not atteso.exists():
        print(f"{copione.name}: manca {atteso.name} (crealo con --aggiorna dopo aver controllato le schermate)", file=sys.stderr)
        return 1
    prima = atteso.read_text(encoding="utf-8")
    if prima != testo:
        sys.stderr.writelines(difflib.unified_diff(prima.splitlines(True), testo.splitlines(True), atteso.name, "ottenuto"))
        return 1
    print(f"{copione.name}: uguale al risultato atteso ({len(uscita)} righe)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
