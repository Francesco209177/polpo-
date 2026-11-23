#!/usr/bin/env python3
"""Genera i casi di prova «ir_codifica» per la copia JavaScript della codifica infrarossi del firmware.

Compila con il compilatore C++ del sistema (``c++``, oppure quello in $CXX; C++17) il banco di prova
ir_codifica_banco.cpp insieme al codice puro del firmware (polpo/lib/polpo_core/src/polpo/ir/ir_codec.cpp,
ir_signal.cpp e util/strutil.cpp), lo esegue su molti segnali (tutti i protocolli, indirizzi e comandi ai limiti e
casuali con semi fissi, toggle sì/no per RC5/RC6, segnali RAW validi e no, nomi di protocollo strani) e scrive i
risultati in site/tests/studio/casi/ir_codifica/*.json. Le prove in site/tests/studio/vari5/ir_codifica.test.mjs
controllano che site/assets/js/studio/protocolli/ir_codifica.js dia esattamente gli stessi tempi.

Uso, dalla radice del repository:
    python site/tests/studio/casi/genera_ir_codifica.py
Rigenerare deve dare file identici byte per byte. Serve solo la libreria standard di Python e un compilatore C++.

Convenzioni nei file: i tempi sono testi di numeri separati da spazi ("9000 4500 560 ..."); un segnale che il
firmware rifiuta ha "r": null; il duty è il valore esatto del float del firmware.
"""

from __future__ import annotations

import json
import os
import random
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path

QUI = Path(__file__).resolve().parent
RADICE = QUI.parents[3]
NUCLEO = RADICE / "polpo" / "lib" / "polpo_core" / "src"
SORGENTI = [QUI / "ir_codifica_banco.cpp", NUCLEO / "polpo/ir/ir_codec.cpp", NUCLEO / "polpo/ir/ir_signal.cpp", NUCLEO / "polpo/util/strutil.cpp"]
USCITA = QUI / "ir_codifica"

# Stesso ordine dell'enum IrProtocol del firmware.
PROTOCOLLI = ["NEC", "NECext", "NEC42", "NEC42ext", "Samsung32", "RC5", "RC5X", "RC6", "SIRC", "SIRC15", "SIRC20", "Kaseikyo", "RCA", "Pioneer"]
BIT = {"NEC": (8, 8), "NECext": (16, 16), "NEC42": (13, 8), "NEC42ext": (26, 16), "Samsung32": (8, 8), "RC5": (5, 6), "RC5X": (5, 7), "RC6": (8, 8),
       "SIRC": (5, 7), "SIRC15": (8, 7), "SIRC20": (13, 7), "Kaseikyo": (26, 10), "RCA": (4, 8), "Pioneer": (8, 8)}  # fmt: skip
U32 = 0xFFFFFFFF


def compila(cartella: Path) -> Path:
    exe = cartella / "banco"
    cxx = shlex.split(os.environ.get("CXX", "c++"))
    cmd = [*cxx, "-std=c++17", "-O1", "-Wall", "-I", str(NUCLEO), *map(str, SORGENTI), "-o", str(exe)]
    subprocess.run(cmd, check=True)
    return exe


def esa(nome: str) -> str:
    return nome.encode("utf-8").hex() if nome else "-"


def tempi(t: list[int]) -> str:
    return " ".join(map(str, t))


class Banco:
    def __init__(self, exe: Path) -> None:
        self.exe = exe
        self.righe: list[str] = []

    def esegui(self, richieste: list[str]) -> list[str]:
        r = subprocess.run([str(self.exe)], input="\n".join(richieste) + "\n", capture_output=True, text=True, check=True)
        return r.stdout.splitlines()


def risposta(riga: str) -> dict | None:
    p = riga.split()
    if p[0] == "no":
        return None
    assert p[0] == "ok", riga
    n = int(p[3])
    d = [int(x) for x in p[4:]]
    assert len(d) == n, riga
    return {"frequenza": int(p[1]), "duty": float(p[2]), "tempi": tempi(d)}


def nomi_prova(rnd: random.Random) -> list[str]:
    out = list(PROTOCOLLI) + ["NEC42ext", "Unknown", "", "Foo", "nec", "NEC ", " NEC", "necEXT", "SAMSUNG32", "rc5x", "Rc6", "sirc", "Sirc15", "sIRC20",
                              "KASEIKYO", "rca", "PIONEER", "NEC4", "NEC422", "ＮＥＣ", "\u212aaseikyo", "NEC\u0000", "Samsung", "RC-5", "SIRC12", "È"]  # fmt: skip
    for _ in range(20):
        n = rnd.choice(PROTOCOLLI)
        out.append("".join(c.upper() if rnd.random() < 0.5 else c.lower() for c in n))
    return out


def valori(rnd: random.Random, bit: int) -> list[int]:
    m = (1 << bit) - 1
    v = [0, 1, m, m - 1 if m > 1 else 0, m + 1, (m + 1) | 1, U32, 0x80000000, 0x7FFFFFFF, 0xAAAAAAAA & m, 0x55555555 & m]
    v += [rnd.randint(0, m) for _ in range(6)] + [rnd.randint(0, U32) for _ in range(3)]
    return v


def casi_parsed(rnd: random.Random) -> list[dict]:
    casi = []
    for p in PROTOCOLLI:
        ba, bc = BIT[p]
        va, vc = valori(rnd, ba), valori(rnd, bc)
        coppie = [(a, c) for a in va[:7] for c in vc[:3]] + list(zip(va, reversed(vc)))
        coppie += [(rnd.randint(0, (1 << ba) - 1), rnd.randint(0, (1 << bc) - 1)) for _ in range(25)]
        for a, c in coppie:
            if p in ("RC5", "RC5X", "RC6"):
                toggle = [False, True]
            else:
                toggle = [rnd.random() < 0.5]
            for t in toggle:
                casi.append({"p": p, "a": a, "c": c, "t": t})
    for n in nomi_prova(rnd):
        casi.append({"p": n, "a": rnd.randint(0, 0xFF), "c": rnd.randint(0, 0xFF), "t": rnd.random() < 0.5})
    return casi


def casi_raw(rnd: random.Random) -> list[dict]:
    casi = []

    def aggiungi(t: list[int], f: int = 38000, d: float = 0.33) -> None:
        casi.append({"f": f, "d": d, "tempi": t})

    aggiungi([9000, 4500, 560])
    aggiungi([])
    aggiungi([1])
    aggiungi([0])
    aggiungi([500, 0, 500])
    aggiungi([100000])
    aggiungi([100001])
    aggiungi([U32])
    aggiungi([100000] * 20)
    aggiungi([100000] * 20 + [1])
    aggiungi([1000] * 1024)
    aggiungi([1000] * 1025)
    aggiungi([1] * 1024)
    aggiungi([560, 560])
    aggiungi([600] * 7, 0, 0.0)
    aggiungi([600] * 7, U32, 1.0)
    aggiungi([600] * 7, 455000, 0.5)
    aggiungi([600] * 7, 36000, 0.25)
    aggiungi([600] * 7, 40000, 0.1)
    aggiungi([600] * 7, 56000, 0.75)
    for _ in range(50):
        n = rnd.choice([rnd.randint(1, 40), rnd.randint(1, 300), rnd.randint(1000, 1100)])
        lim = rnd.choice([3000, 30000, 100000, 100002])
        t = [rnd.randint(1 if rnd.random() < 0.97 else 0, lim) for _ in range(n)]
        aggiungi(t, rnd.choice([38000, 36000, rnd.randint(10000, 100000), rnd.randint(0, 200000)]), rnd.choice([0.33, 0.5, round(rnd.random(), rnd.randint(1, 6)), rnd.random()]))
    return casi


def main() -> None:
    rnd = random.Random(55)
    parsed = casi_parsed(rnd)
    raw = casi_raw(rnd)
    nomi = nomi_prova(random.Random(56))
    totali = [[], [1], [U32, U32], [9000, 4500, 560], [U32] * 1100] + [[rnd.randint(0, U32) for _ in range(rnd.randint(0, 60))] for _ in range(20)]

    richieste = ["I"]
    richieste += [f"N {esa(n)}" for n in nomi]
    richieste += [f"P {esa(c['p'])} {c['a']} {c['c']} {int(c['t'])}" for c in parsed]
    richieste += [f"R {c['f']} {c['d']!r} {len(c['tempi'])} {tempi(c['tempi'])}".rstrip() for c in raw]
    richieste += [f"T {len(t)} {tempi(t)}".rstrip() for t in totali]

    with tempfile.TemporaryDirectory() as cartella:
        righe = Banco(compila(Path(cartella))).esegui(richieste)

    i = 0
    protocolli = []
    while i < len(righe) and righe[i].startswith("info "):
        _, n, nome, ba, bc, f, d, fr, gap = righe[i].split()
        protocolli.append({"n": int(n), "nome": nome, "bit_indirizzo": int(ba), "bit_comando": int(bc), "frequenza": int(f), "duty": float(d), "frame_minimi": int(fr), "pausa_frame_us": int(gap)})
        i += 1
    out_nomi = []
    for n in nomi:
        assert righe[i].startswith("nome "), righe[i]
        out_nomi.append({"nome": n, "r": int(righe[i].split()[1])})
        i += 1
    out_parsed = []
    for c in parsed:
        out_parsed.append({**c, "r": risposta(righe[i])})
        i += 1
    out_raw = []
    for c in raw:
        out_raw.append({"f": c["f"], "d": c["d"], "tempi": tempi(c["tempi"]), "r": risposta(righe[i])})
        i += 1
    out_totali = []
    for t in totali:
        assert righe[i].startswith("totale "), righe[i]
        out_totali.append({"tempi": tempi(t), "r": int(righe[i].split()[1])})
        i += 1
    assert i == len(righe), "righe in più dal banco di prova"

    USCITA.mkdir(parents=True, exist_ok=True)
    dati = {"protocolli": protocolli, "nomi": out_nomi, "parsed": out_parsed, "raw": out_raw, "totali": out_totali}
    testo = json.dumps(dati, sort_keys=True, indent=1, ensure_ascii=False) + "\n"
    (USCITA / "ir_codifica.json").write_text(testo, encoding="utf-8", newline="\n")
    print(f"ir_codifica.json: {sum(len(v) for v in dati.values())} casi")


if __name__ == "__main__":
    if sys.version_info < (3, 9):
        sys.exit("serve Python 3.9 o più recente")
    main()
