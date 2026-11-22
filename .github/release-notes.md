Firmware per M5Stack Cardputer e **Polpo Studio** per PC.

Sito del progetto, con simulatore e installazione del firmware dal browser: {{sito}}

| File | Cos'è |
|---|---|
| `PolpoStudio-Windows-setup.exe` | Polpo Studio per Windows 10/11 (installer) |
| `PolpoStudio-windows-x64.zip` | Polpo Studio per Windows, senza installazione |
| `PolpoStudio-linux-x64.tar.gz` | Polpo Studio per Linux (Ubuntu 22.04 o più recente), con `installa.sh` |
| `polpo-cardputer-<versione>.bin` | Firmware completo per il Cardputer (indirizzo `0x0`) |
| `polpo-cardputer-<versione>-app.bin` | Solo l'applicazione, per gli aggiornamenti (indirizzo `0x10000`) |
| `sd-polpo.zip` | Cartelle e file d'esempio da copiare sulla microSD |
| `SHA256SUMS.txt` | Impronte SHA-256 di tutti i file |

**Da sapere**

- Verificato con test automatici, simulatore e autodiagnosi dei pacchetti; **non ancora provato su hardware vero**.
- L'installer per Windows non è firmato: Windows può mostrare «PC protetto» (Ulteriori informazioni › Esegui comunque).
- macOS: per ora Polpo Studio si avvia dal codice sorgente.
- Usa Polpo solo con dispositivi tuoi o per cui hai l'autorizzazione.
