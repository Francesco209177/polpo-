Firmware per M5Stack Cardputer, **Polpo Studio** per PC e l'**app per Android**.

Sito del progetto, con simulatore e installazione del firmware dal browser: {{sito}}

**Novità della 0.4.0: Polpo Studio nel telefono**

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
- Firmware: identico alla 0.3.0, cambia solo il numero di versione. Polpo Studio per PC: corretto il registro
  attività, che andava in errore su una riga rovinata.

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
| `Polpo-Android.apk` | L'app per Android: Polpo Studio nel telefono, simulatore, Script, Onde, manuali, senza Internet |
| `sd-polpo.zip` | Cartelle e file d'esempio da copiare sulla microSD |
| `SHA256SUMS.txt` | Impronte SHA-256 di tutti i file |

**Da sapere**

- Verificato con test automatici, simulatore, autodiagnosi dei pacchetti e un telefono Android emulato;
  **non ancora provato su hardware vero** (né Cardputer né telefono, né il cavo OTG).
- L'app per Android non arriva dal Play Store: Android chiede di consentire l'installazione e Play Protect può
  avvisare. Il certificato di firma è sempre lo stesso; la sua impronta SHA-256 è sulla pagina «Telefono» del sito.
- L'installer per Windows non è firmato: Windows può mostrare «PC protetto» (Ulteriori informazioni › Esegui comunque).
- macOS: per ora Polpo Studio si avvia dal codice sorgente.
- Usa Polpo solo con dispositivi tuoi o per cui hai l'autorizzazione.
