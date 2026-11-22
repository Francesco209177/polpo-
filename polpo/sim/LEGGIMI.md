# Simulatore del Polpo: il firmware vero, fuori dal dispositivo

Questa cartella permette di compilare ed eseguire il **firmware vero** (`polpo/src`, senza cambiarne una riga) su un
PC e, compilato in WebAssembly, in una pagina web. Serve a due cose: provare l'interfaccia con prove automatiche
(tasti in ingresso, schermate in uscita) e far girare nel simulatore del sito il codice reale invece di una copia.

PlatformIO non compila questa cartella: il firmware per il Cardputer non ne è toccato.

## Cosa è vero e cosa è simulato

| Parte | Com'è qui |
|---|---|
| Menu, schermate, app, logica, formati dei file, Polpo Link | **codice vero** (`polpo/src`, `polpo/lib/polpo_core`) |
| Motore grafico e caratteri | **veri**: LovyanGFX dentro la libreria M5GFX, la stessa versione del dispositivo; i pixel finiscono in una tela in memoria |
| Moduli infrarossi, radio 433 MHz, NFC, tastiera USB, porta Grove (`src/hal`) | **codice vero**, compresa la libreria rc-switch; simulato è ciò che sta sotto: piedini, periferica RMT, bus I2C, porta USB, chip del lettore NFC |
| Bluetooth (`src/hal/ble.cpp`) | **simulato per intero** (`sim/hal/ble.cpp`): la pila Bluetooth vera non esiste qui |
| Wi-Fi | **simulato**: la scansione restituisce reti inventate |
| Tempo | **virtuale**: avanza quando il firmware aspetta. I tempi reali dei driver non sono provati |
| Memoria | quella del PC: i limiti di RAM dell'ESP32 **non** sono simulati |
| Mondo esterno (`mondo.cpp`) | **inventato**: telecomando, presa a 433 MHz, tag NFC, PC, reti e dispositivi vicini. Nessuna onda viene emessa o ricevuta |

Quindi il simulatore dimostra che menu, logica e formati funzionano; **non** dimostra che il firmware funzioni su un
Cardputer vero, dove contano driver, tempi e memoria.

## Compilare ed eseguire le prove

```bash
pio pkg install -d polpo -e cardputer        # scarica le librerie fissate in platformio.ini
cmake -S polpo/sim -B build/sim -G Ninja     # con controlli di memoria (AddressSanitizer, UBSan)
cmake --build build/sim
ctest --test-dir build/sim --output-on-failure
```

Ogni prova è un copione di testo in `tests/` (`.copione`) con il risultato atteso accanto (`.atteso`): impronte delle
schermate, risposte del mondo simulato, eventi (trasmissioni viste dal mondo, tasti USB, suoni). Per guardare le
schermate di una prova:

```bash
python3 polpo/sim/tests/confronta.py build/sim/polpo_host polpo/sim/tests/01_avvio.copione --immagini /tmp/schermate
```

Dopo una modifica voluta all'interfaccia si controllano le immagini e poi si rigenera il risultato atteso con
`--aggiorna`.

## Per il browser

```bash
polpo/sim/scripts/compila_web.sh build/web          # scarica librerie ed Emscripten (versione fissata), compila
for c in polpo/sim/tests/*.copione; do              # le stesse prove, sul modulo WebAssembly
  python3 polpo/sim/tests/confronta.py "node polpo/sim/tests/esegui_wasm.mjs build/web/polpo-sim.wasm" "$c"
done
python site/build.py --out site/_site --check --firmware-web build/web    # il sito con il simulatore vero
```

Il risultato è `polpo-sim.wasm`: un modulo WebAssembly "nudo" (circa 630 KB), senza codice JavaScript generato e
senza funzioni di sistema importate, quindi non può toccare file, rete o orologio del computer che lo esegue.
Espone solo le funzioni di `host/sim.h`. Due compilazioni dagli stessi sorgenti danno lo stesso file, byte per byte.
Le prove per PC e quelle sul modulo usano lo stesso risultato atteso: schermate identiche punto per punto.

## Com'è fatto

- `platform/`: finte intestazioni (`Arduino.h`, `M5Cardputer.h`, `SD.h`, `WiFi.h`, `Preferences.h`, `Wire.h`, `USB.h`,
  `MFRC522_I2C.h`…) e la loro realizzazione in `piattaforma.cpp`: orologio virtuale con eventi programmati, piedini
  con interrupt, RMT, seriale, microSD e impostazioni in memoria.
- `lgfx/lgfx_tutto.cpp`: include i sorgenti del motore grafico così come sono.
- `mondo.cpp`: gli oggetti inventati e i comandi JSON per muoverli; decodifica e racconta ciò che il firmware trasmette.
- `hal/ble.cpp`: il Bluetooth simulato.
- `host/sim.h`: le quindici funzioni con cui pagina web, prove e Polpo Studio comandano il simulatore.
- `host/polpo_host.cpp`: esegue un copione sul PC.
- `scripts/`: `compila_web.sh` (tutto il necessario per il browser), `emscripten.sh` (scarica il compilatore e ne
  controlla l'impronta), `librerie.py` (scarica solo le tre librerie che servono), `incorpora.py` (file d'esempio).
- `../../site/assets/js/simulatore/firmware.js`: carica il modulo in JavaScript; `tests/esegui_wasm.mjs` lo usa per
  le prove, `site/assets/js/simulatore/pagina.js` per la pagina del sito.
