Firmware per M5Stack Cardputer, **Polpo Studio** per PC e l'**app per Android**.

Sito del progetto, con simulatore e installazione del firmware dal browser: {{sito}}

**Novità della 0.5.0: il telefono da solo**

- L'app per Android usa **l'hardware vero del telefono**, anche senza Cardputer:
  - **NFC**: legge i tag e scrive un link o un testo NDEF sui *tuoi* tag (modalità laboratorio e conferma, poi
    rilettura per verificare). Niente emulazione di carte, niente formattazione o blocco dei tag.
  - **Bluetooth**: ricerca passiva dei dispositivi vicini; letture e notifiche solo dai dispositivi che hai
    autorizzato (registro nella cassaforte). Niente scritture, abbinamenti o annunci.
  - **Infrarossi**: «Invia con il telefono» se il telefono ha l'emettitore.
- Con il **cavo OTG** (*Sperimentale*): lettori RFID 125 kHz «a tastiera» e RDM6300, **console seriale** (mai 1200
  baud), schede collegate, **Polpo Bridge** (pin, ADC, I2C) e chiavi **iButton** (solo il codice), e
  l'**aggiornamento del firmware** del Polpo dal telefono: solo l'applicazione a 0x10000, solo il file incluso
  nell'app con l'impronta SHA-256 fissata, con modalità laboratorio e conferma (esptool-js 0.7.1, Apache-2.0).
- Nuovi moduli e schede nel telefono: Bluetooth, RFID 125 kHz, iButton, USB (con il tester di tastiera e mouse e
  l'editor **DuckyScript**, che copia lo script sul Polpo con la conferma sul suo schermo: dal telefono non parte
  mai), App (convertitori, CRC, NDEF, tempo di trasmissione radio), calcolatori di elettronica.
- Altri ~3.500 casi di prova confrontano il JavaScript con il codice Python e C++ originale.
- Firmware: le ripetizioni di un tasto infrarossi RC5/RC6 (impostazione «Ripetizioni IR» sopra 1) ora tengono lo
  stesso bit «toggle», così il televisore vede una sola pressione.
- Permessi nuovi dell'app, chiesti al momento: *Dispositivi nelle vicinanze* (Android 12 e successivi, dichiarato
  «mai per la posizione») oppure la posizione fino ad Android 11, solo per la ricerca Bluetooth. Sempre **nessun
  permesso Internet**.

**Dalla 0.4.0: Polpo Studio nel telefono**

- Nell'app per Android c'è **Polpo Studio**: comanda il **Polpo vero con un cavo USB OTG** (Android chiede il
  permesso, poi accetti il collegamento sullo schermo del Polpo) oppure il **Polpo virtuale**, cioè il firmware vero
  eseguito nel telefono, con il suo schermo per le conferme e un piccolo mondo simulato.
- Moduli: Polpo (informazioni, diagnostica, microSD, reti vicine), Script, Infrarossi, Radio 433 (ricezione, RAW,
  archivio con i tuoi dispositivi, trasmissione), NFC (lettura, analisi, scrittura su tag tuoi), GPIO, Archivio,
  Sicurezza, Registro e l'elenco di tutte le funzioni con il loro stato.
- La stessa **cassaforte cifrata** del programma per PC: i backup **`.polpobak` si scambiano tra telefono e PC**.
  Trasmettere e scrivere richiedono la modalità laboratorio e la conferma sullo schermo del Polpo, come sul PC.
- La logica di Polpo Studio è stata riscritta in JavaScript e confrontata con quella Python su circa 27.000 casi di
  prova generati automaticamente.

**Dalla 0.3.0**

- **App per Android** (`Polpo-Android.apk`, Android 8.0 o più recente) con il simulatore, PolpoScript, Polpo Onde e
  tutti i manuali, **senza Internet** (l'app non chiede nemmeno il permesso). Come installarla: pagina «Telefono»
  del sito.

**Dalla 0.2.0**

- **PolpoScript**, un piccolo linguaggio in italiano per le mini-app (`se … allora`, `ripeti 3 volte`, `fine`):
  app «Script» sul Polpo con quattro esempi (pallina, indovina, dado, serpente), modulo «Script» in Polpo Studio
  (editor, controllo degli errori, esecuzione una riga alla volta con le variabili) e riquadro nel simulatore del sito.
  Uno script disegna, suona e legge i tasti: non può trasmettere niente.
- Il **simulatore del sito** esegue il firmware vero, compilato per il browser.
- Polpo Link: comandi `script.*` (l'avvio dal PC chiede conferma sullo schermo del Polpo).

| File | Cos'è |
|---|---|
| `PolpoStudio-Windows-setup.exe` | Polpo Studio per Windows 10/11 (installer) |
| `PolpoStudio-windows-x64.zip` | Polpo Studio per Windows, senza installazione |
| `PolpoStudio-linux-x64.tar.gz` | Polpo Studio per Linux (Ubuntu 22.04 o più recente), con `installa.sh` |
| `polpo-cardputer-<versione>.bin` | Firmware completo per il Cardputer (indirizzo `0x0`) |
| `polpo-cardputer-<versione>-app.bin` | Solo l'applicazione, per gli aggiornamenti (indirizzo `0x10000`) |
| `Polpo-Android.apk` | L'app per Android: Polpo Studio nel telefono (anche con NFC, Bluetooth e infrarossi del telefono), simulatore, Script, Onde, manuali, senza Internet |
| `sd-polpo.zip` | Cartelle e file d'esempio da copiare sulla microSD |
| `SHA256SUMS.txt` | Impronte SHA-256 di tutti i file |

**Da sapere**

- Verificato con test automatici, simulatore, autodiagnosi dei pacchetti e un telefono Android emulato;
  **non ancora provato su hardware vero** (né Cardputer né telefono, né il cavo OTG, l'NFC, il Bluetooth o
  l'aggiornamento del firmware dal telefono).
- L'app per Android non arriva dal Play Store: Android chiede di consentire l'installazione e Play Protect può
  avvisare. Il certificato di firma è sempre lo stesso; la sua impronta SHA-256 è sulla pagina «Telefono» del sito.
- L'installer per Windows non è firmato: Windows può mostrare «PC protetto» (Ulteriori informazioni › Esegui comunque).
- macOS: per ora Polpo Studio si avvia dal codice sorgente.
- Usa Polpo solo con dispositivi tuoi o per cui hai l'autorizzazione.
