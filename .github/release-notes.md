Firmware per M5Stack Cardputer, **Polpo Studio** per PC e l'**app per Android**.

Sito del progetto, con simulatore e installazione del firmware dal browser: {{sito}}

**Novità della 0.3.0**

- **App per Android** (`Polpo-Android.apk`, Android 8.0 o più recente): il simulatore con il firmware vero,
  PolpoScript, Polpo Onde con il microfono del telefono e tutti i manuali, **senza Internet** (l'app non chiede
  nemmeno il permesso). Come installarla: pagina «Telefono» del sito. Comandare il Polpo vero dal telefono arriverà
  nelle prossime versioni.
- Firmware e Polpo Studio sono identici alla 0.2.0, cambia solo il numero di versione.

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
| `Polpo-Android.apk` | L'app per Android (simulatore, Script, Onde, manuali), senza Internet |
| `sd-polpo.zip` | Cartelle e file d'esempio da copiare sulla microSD |
| `SHA256SUMS.txt` | Impronte SHA-256 di tutti i file |

**Da sapere**

- Verificato con test automatici, simulatore, autodiagnosi dei pacchetti e un telefono Android emulato;
  **non ancora provato su hardware vero** (né Cardputer né telefono).
- L'app per Android non arriva dal Play Store: Android chiede di consentire l'installazione e Play Protect può
  avvisare. Il certificato di firma è sempre lo stesso; la sua impronta SHA-256 è sulla pagina «Telefono» del sito.
- L'installer per Windows non è firmato: Windows può mostrare «PC protetto» (Ulteriori informazioni › Esegui comunque).
- macOS: per ora Polpo Studio si avvia dal codice sorgente.
- Usa Polpo solo con dispositivi tuoi o per cui hai l'autorizzazione.
