#!/usr/bin/env python3
"""Controlli su PolpoScript che non si possono fare con un test normale.

    check_script.py            cosa può toccare uno script (solo lettura dei sorgenti)
    check_script.py --pila     in più: quanta pila usa, nel caso peggiore, il compilatore sul Cardputer

1. RECINTO. Uno script può usare schermo, tasti, suoni, orologio e i file della propria cartella. Non deve poter
   trasmettere (radio, infrarossi, NFC), scrivere come tastiera USB, usare Bluetooth o Wi-Fi, né parlare con il PC.
   Il linguaggio non ha funzioni per farlo (lo fissa un test); qui si controlla che il codice che lo esegue non
   includa nemmeno i moduli che lo fanno, così nessuno può aggiungerle per sbaglio.

2. PILA. Il compilatore analizza espressioni e blocchi uno dentro l'altro, e sul Cardputer la pila è poca. La
   profondità è limitata; qui si compila per l'ESP32-S3 chiedendo al compilatore quanta pila usa ogni funzione e
   si calcola il caso peggiore, che deve stare largamente dentro la pila del ciclo principale (vedi main.cpp).
   Serve la catena di compilazione dell'ESP32 (c'è dopo «pio run -e cardputer»).
"""
import re
import subprocess
import sys
import tempfile
from pathlib import Path

POLPO = Path(__file__).resolve().parents[1]
LINGUAGGIO = POLPO / "lib/polpo_core/src/polpo/script"
APP = [POLPO / "src/apps/script_app.cpp", POLPO / "src/apps/script_runner.h"]

STANDARD = {"algorithm", "cmath", "cstddef", "cstdint", "deque", "functional", "map", "memory", "string", "utility", "vector"}
INCLUDE_LINGUAGGIO = {"polpo/util/utf8.h"}  # più tutto polpo/script/
INCLUDE_APP = {
    "M5Cardputer.h",  # schermo, tastiera, altoparlante
    "apps/apps.h", "apps/script_runner.h", "core/gfx.h", "core/settings.h", "core/sound.h", "core/storage.h",
    "core/widgets.h", "polpo/script/script.h",
}
# Nomi dei moduli che trasmettono o parlano con l'esterno: non devono comparire nel codice dell'app.
VIETATI = [
    r"\bir::", r"\brf433::", r"\bnfc::", r"\busb_kbd::", r"\bble::", r"\bgrove::", r"\bpclink::", r"\bWiFi\b", r"\bNimBLE",
    r"\bRCSwitch\b", r"\bMFRC522", r"\bSerial\b", r"\bUSBHID", r"\brmt[A-Z]\w*\(", r"\bdigitalWrite\b", r"\bpinMode\b",
    r"\bWire\b", r"\bHTTPClient\b",
]


def senza_commenti(testo: str) -> str:
    testo = re.sub(r"/\*.*?\*/", "", testo, flags=re.S)
    return "\n".join(riga.split("//")[0] for riga in testo.splitlines())


def recinto() -> list[str]:
    guai = []
    for f in sorted(LINGUAGGIO.glob("*")):
        for inc in re.findall(r'^\s*#\s*include\s*[<"]([^>"]+)[>"]', f.read_text(encoding="utf-8"), re.M):
            if inc in STANDARD or inc in INCLUDE_LINGUAGGIO or inc.startswith("polpo/script/"):
                continue
            guai.append(f"{f.relative_to(POLPO)}: include «{inc}», che il linguaggio non deve usare")
    for f in APP:
        testo = f.read_text(encoding="utf-8")
        for inc in re.findall(r'^\s*#\s*include\s*[<"]([^>"]+)[>"]', testo, re.M):
            if inc not in STANDARD and inc not in INCLUDE_APP:
                guai.append(f"{f.relative_to(POLPO)}: include «{inc}», che l'app degli script non deve usare")
        codice = senza_commenti(testo)
        for modello in VIETATI:
            m = re.search(modello, codice)
            if m:
                guai.append(f"{f.relative_to(POLPO)}: usa «{m.group(0)}», vietato al codice che esegue gli script")
    return guai


def pila() -> list[str]:
    compilatori = sorted(Path.home().glob(".platformio/packages/toolchain-xtensa-esp*/bin/xtensa-esp32s3-elf-g++"))
    if not compilatori:
        return ["non trovo il compilatore dell'ESP32-S3: esegui prima «pio run -e cardputer»"]
    usi: dict[str, int] = {}
    with tempfile.TemporaryDirectory() as tmp:
        for nome in ("compiler", "lexer"):
            subprocess.run(
                [str(compilatori[0]), "-std=gnu++17", "-Os", "-mlongcalls", "-fno-rtti", "-fno-exceptions", "-fstack-usage",
                 f"-I{POLPO / 'lib/polpo_core/src'}", "-c", str(LINGUAGGIO / f"{nome}.cpp"), "-o", f"{tmp}/{nome}.o"],
                check=True)
            for riga in Path(f"{tmp}/{nome}.su").read_text(encoding="utf-8").splitlines():
                parti = riga.split("\t")
                funzione = re.sub(r"^.*?:\d+:\d+:", "", parti[0])
                usi[funzione] = max(usi.get(funzione, 0), int(parti[1]))

    def uso(nome: str) -> int:  # 0 se la funzione è stata fusa dentro chi la chiama
        return max((v for k, v in usi.items() if re.search(rf"\b{re.escape(nome)}\(", k)), default=0)

    sorgente = (LINGUAGGIO / "compiler.cpp").read_text(encoding="utf-8")
    espressioni = int(re.search(r"kMaxExprDepth = (\d+)", sorgente).group(1))
    blocchi = int(re.search(r"kMaxBlockDepth = (\d+)", sorgente).group(1))
    main = (POLPO / "src/main.cpp").read_text(encoding="utf-8")
    m = re.search(r"SET_LOOP_TASK_STACK_SIZE\((\d+) \* 1024\)", main)
    disponibile = int(m.group(1)) * 1024 if m else 8192

    per_blocco = uso("Compiler::block") + uso("Compiler::statement") + max(
        uso("Compiler::if_statement"), uso("Compiler::repeat_statement"), uso("Compiler::for_statement"))
    per_espressione = uso("Compiler::expression") + uso("Compiler::unary") + uso("Compiler::primary") + uso("Compiler::call")
    foglia = 2 * max(usi.values())  # l'ultima funzione chiamata e ciò che chiama a sua volta (messaggi, lettura delle parole)
    peggiore = (uso("script::compile") + uso("Compiler::run") + uso("Compiler::function_statement") + blocchi * per_blocco
                + uso("Compiler::simple_statement") + uso("Compiler::assignment_or_call") + espressioni * per_espressione + foglia)
    sotto = 1536  # ciò che c'è già sulla pila quando parte la compilazione, più un margine per le interruzioni
    limite = disponibile * 3 // 4
    print(f"pila del compilatore di PolpoScript sull'ESP32-S3: caso peggiore {peggiore} byte "
          f"({blocchi} blocchi x {per_blocco} + {espressioni} espressioni x {per_espressione} + il resto); "
          f"con {sotto} già usati fanno {peggiore + sotto} su {disponibile} (limite che ci diamo: {limite})")
    if per_blocco == 0 or per_espressione == 0:
        return ["non riesco a leggere quanta pila usano le funzioni del compilatore: il controllo va aggiornato"]
    if peggiore + sotto > limite:
        return [f"il compilatore di PolpoScript può usare {peggiore + sotto} byte di pila: troppi per i {disponibile} disponibili"]
    return []


def main() -> int:
    guai = recinto()
    if "--pila" in sys.argv:
        guai += pila()
    for g in guai:
        print("ERRORE:", g, file=sys.stderr)
    if not guai:
        print("PolpoScript: il codice che esegue gli script non tocca radio, infrarossi, NFC, USB, Bluetooth, Wi-Fi né il PC")
    return 1 if guai else 0


if __name__ == "__main__":
    raise SystemExit(main())
