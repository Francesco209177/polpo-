# Polpo Studio — manuale

Polpo Studio è il programma per PC che accompagna il **Polpo** (M5Stack Cardputer con il firmware Polpo).
Comanda il Polpo via USB, usa i lettori esterni economici e conserva tutto in una cassaforte cifrata.

## 1. Installazione

| Sistema | Come |
|---|---|
| **Windows 10/11** | Scarica `PolpoStudio-<versione>-Windows-setup.exe` dagli artefatti della build e avvialo. In alternativa lo zip: estrai e avvia `PolpoStudio.exe`. |
| **Linux** (Ubuntu 22.04 o più recente) | Estrai `PolpoStudio-linux-x64.tar.gz` e lancia `./installa.sh`: copia il programma in `~/.local` e, se vuoi, installa la regola udev per le porte seriali. |
| **macOS** | Per ora solo da sorgente (vedi sotto): senza firma Apple il sistema bloccherebbe il programma e richiederebbe il permesso Bluetooth a ogni aggiornamento. |

**Da sorgente** (qualsiasi sistema con Python 3.11 o più recente):

```bash
cd studio
python -m venv .venv && . .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
python -m polpo_studio
```

Opzioni utili: `--virtuale` (parte con il Polpo virtuale), `--lingua en`, `--dati CARTELLA`, `--self-test`
(autodiagnosi senza hardware: deve dire "Tutto a posto.").

## 2. Prima apertura: la cassaforte

Alla prima apertura scegli una **frase di accesso** (almeno 12 caratteri; meglio quattro parole a caso) e
ricevi una **chiave di recupero** di 32 caratteri. **Scrivila su carta**: se dimentichi la frase è l'unico modo
per recuperare i dati. Poi puoi impostare un **PIN** per sbloccare velocemente lo schermo.
Dettagli in [SICUREZZA.md](SICUREZZA.md).

## 3. Gli stati delle funzioni

Ogni funzione di ogni modulo mostra uno stato calcolato dal vivo, sempre scritto a parole:

| Stato | Significato | Cosa fare |
|---|---|---|
| **Disponibile** | L'hardware è collegato e rilevato (o dichiarato da te), oppure non serve hardware | Usala |
| **Richiede hardware esterno** | Manca un componente, oppure non si può rilevare da solo | Guarda "Cosa serve" in fondo alla pagina del modulo |
| **Simulato** | Funziona col Polpo virtuale: dati inventati | Nulla: è una prova. Questi dati non vanno mai al Polpo vero |
| **Sperimentale** | Funziona ma non è stato provato a fondo sull'hardware vero | Usala con attenzione |
| **Non disponibile** | Esclusa per sicurezza o impossibile con questo hardware | — |

Alcuni componenti (unità RF433, IR Unit, lettore RFID USB "tipo tastiera", RDM6300, sonda 1-Wire) **non si possono
rilevare automaticamente**: se li hai collegati, dichiaralo in **Impostazioni › Hardware**.

## 4. Collegare il Polpo

1. Sul Cardputer deve esserci il firmware Polpo (versione con Polpo Link).
2. Collegalo con un cavo USB **dati** e premi **Home › Collega via USB…**, scegli la porta.
3. Sul Polpo compare **"Collegare al PC?"**: premi Sì. Il Polpo mostra "Collegato al PC" e chiude le altre app
   (la porta Grove è condivisa). Premendo Indietro sul Polpo il collegamento si chiude.

Senza hardware puoi usare **Home › Usa il Polpo virtuale**: tutto ciò che produce è segnato **SIMULATO**.

## 5. I moduli

| Modulo | Cosa fa | Serve |
|---|---|---|
| **Polpo** | Informazioni, diagnostica (microSD, I2C), file della microSD (sfoglia, scarica, carica, backup .zip), reti Wi-Fi e Bluetooth vicine (non salvate), aggiornamento firmware (Sperimentale) | Polpo |
| **Radio 433 MHz** | Ricezione di codici fissi, cattura RAW con grafico e analisi degli impulsi, archivio legato ai **tuoi** dispositivi, editor `.sub`, bande supportate, trasmissione (modalità laboratorio + doppia conferma), report | Polpo + RF433R/RF433T |
| **NFC** | Lettura di NTAG/Ultralight con analisi (UID, blocchi, CC, NDEF), analizzatore NDEF, scrittura su tag tuoi, archivio, report; lettore PC/SC Sperimentale | Polpo + RFID2, oppure lettore PC/SC |
| **RFID 125 kHz** | Lettura con lettore USB "tipo tastiera" (controlla la velocità di scrittura) o RDM6300, formati EM4100 / decimale / Wiegand 26, archivio | Lettore USB o RDM6300 |
| **Infrarossi** | Libreria di codici pubblici, telecomandi personali, import `.ir`, telecomando grafico, apprendimento | Polpo (+ IR Unit per imparare) |
| **GPIO ed elettronica** | Pin Grove e I2C del Polpo, console seriale, schede riconosciute, programmazione ESP32 (esptool), calcolatori, Polpo Bridge | PC, Polpo, schede Arduino/ESP32 |
| **Bluetooth** | Scansione, dispositivi autorizzati, servizi GATT, letture, notifiche | Adattatore Bluetooth del PC |
| **USB** | Periferiche, porte seriali (con avviso sui driver mancanti), HID (solo elenco), tester tastiera/mouse, editor DuckyScript | PC |
| **iButton** | Ricerca ROM, famiglia, CRC8, archivio (Sperimentale) | Polpo Bridge + sonda 1-Wire |
| **Archivio file** | Tutti i file della cassaforte: categorie, ricerca, note, import/export, verifica | — |
| **App** | App integrate e app di terze parti (solo in modalità laboratorio) | — |
| **Script** | Mini-app in PolpoScript: editor, controllo degli errori, esecuzione e passo passo con le variabili; con il Polpo virtuale anche lo schermo da comandare con la tastiera del PC | Polpo (vero o virtuale) |

### Script

Il modulo **Script** serve a scrivere mini-app in **PolpoScript**, il linguaggio in italiano del Polpo
(manuale del linguaggio: `polpo/docs/POLPOSCRIPT.md`, anche nella Documentazione del sito).

1. Scrivi il programma nell'editor, oppure aprilo da un file `.polpo` del PC o dalla microSD del Polpo
   (**Aggiorna elenco**, scegli, **Apri**). La bozza resta salvata quando chiudi il programma.
2. **Controlla**: il programma viene copiato nella cartella `/polpo/script` del Polpo, che lo controlla con lo stesso
   linguaggio che userà per eseguirlo. Se c'è un errore la riga si colora e il messaggio la indica.
3. **Esegui**: il Polpo chiede conferma sul suo schermo. Ciò che il programma scrive compare in **Che cosa fa**.
4. **Una riga alla volta**: il programma si ferma su ogni riga, la riga si colora e la tabella mostra le variabili.
   **Riga successiva** avanza, **Riprendi** lo lascia andare, **Ferma** lo chiude (come il tasto G0 sul Polpo).

Con il **Polpo virtuale** a eseguire il programma è il firmware vero, compilato per il PC: nel riquadro
**Schermo del Polpo virtuale** vedi ciò che disegna; clicca sullo schermo e usa frecce, Invio (OK), Esc (indietro),
lettere e numeri. Tutto è segnato SIMULATO.

Uno script disegna, suona, legge i tasti e salva piccoli file nella sua cartella: **non può trasmettere** (radio,
infrarossi, NFC), né scrivere come una tastiera USB, né usare Bluetooth e Wi-Fi. Per questo non serve la modalità
laboratorio.

## 6. Modalità laboratorio

Trasmettere a 433 MHz, scrivere tag NFC, programmare schede, pilotare uscite GPIO e usare app di terze parti
richiede la **modalità laboratorio** (Sicurezza › Modalità laboratorio): si accettano le regole d'uso, si conferma
con PIN o frase, e si spegne da sola dopo il tempo scelto, quando blocchi lo schermo e alla chiusura del programma.

## 7. Personalizzazione

In **Impostazioni**: lingua (italiano/inglese), tema scuro/chiaro/alto contrasto, colore principale, dimensione
del testo, stile delle icone, densità, barra laterale compatta, ordine e visibilità dei moduli, scorciatoie da
tastiera, schede della Home, notifiche, hardware dichiarato. In ogni modulo la stella ☆ lo aggiunge ai preferiti.

## 8. Problemi frequenti

| Problema | Soluzione |
|---|---|
| Nessuna porta seriale | Cavo solo di ricarica: usane uno dati. Su Linux installa la regola udev o entra nel gruppo `dialout`. |
| "La porta è già usata" | Chiudi il monitor seriale di Arduino IDE/PlatformIO o un altro Polpo Studio. |
| "Nessuna risposta: su questa porta non c'è un Polpo" | Porta sbagliata, oppure firmware senza Polpo Link: aggiornalo dalla pagina web del flasher. |
| "Rifiutato sullo schermo del Polpo" | Hai premuto No sul Polpo, o sono passati 20 secondi. |
| Bluetooth "Richiede hardware esterno" | Adattatore assente o spento; su Linux serve BlueZ attivo. |
| Funzione "Non verificabile" | Dichiara il componente in Impostazioni › Hardware. |
| Script: "comando sconosciuto" con il Polpo vero | Il firmware è più vecchio della 0.2.0: aggiornalo. |
| Script: "il Polpo virtuale non può eseguire gli script" | Manca il firmware simulato (`polpo-sim.wasm`): succede solo avviando Polpo Studio dal codice sorgente senza averlo costruito. |

## 9. Polpo Studio nel telefono (app per Android)

Dalla versione 0.4 l'**app Polpo per Android** contiene una versione di Polpo Studio pensata per il telefono (voce
«Polpo Studio» del menu dell'app). È la stessa logica del programma per PC, riscritta in JavaScript e controllata
con migliaia di casi di prova generati dal codice Python: i file `.ir` e `.sub`, le analisi e i controlli prima di
trasmettere danno gli stessi risultati.

- **Collegamento**: il Polpo vero con un cavo **USB OTG** (Android chiede il permesso la prima volta; poi accetta il
  collegamento sullo schermo del Polpo, come con il PC), oppure il **Polpo virtuale**: il firmware vero eseguito nel
  telefono, con il suo schermo e i suoi tasti per le conferme e un piccolo mondo simulato (modulo Grove, telecomandi,
  tag). Tutto ciò che viene dal Polpo virtuale è segnato **Simulato** e non si invia mai al Polpo vero.
- **Moduli**: Polpo (informazioni, diagnostica, microSD, reti Wi-Fi e Bluetooth vicine), Script, Infrarossi
  (libreria, telecomandi personali, apprendimento), Radio 433 (ricezione, RAW e analisi, archivio con i tuoi
  dispositivi, editor, report, trasmissione), NFC (lettura e analisi, analizzatore NDEF, archivio, scrittura su tag
  tuoi), GPIO (pin e bus I2C della porta Grove), Archivio, Sicurezza, Registro, Impostazioni e l'elenco di tutte le
  funzioni con il loro stato nel telefono.
- **Sicurezza**: la stessa cassaforte cifrata del PC (frase di accesso, chiave di recupero, PIN e blocco
  automatico, registro attività con catena HMAC). I backup **`.polpobak` si scambiano tra telefono e PC** in entrambe
  le direzioni. Trasmettere e scrivere richiedono la **modalità laboratorio**, con le stesse regole.
- **Non ancora nel telefono**: RFID 125 kHz, iButton, Bluetooth e USB del telefono, console seriale, Polpo Bridge,
  aggiornamento del firmware, DuckyScript e app. Nell'elenco delle funzioni sono segnate «Non disponibile», con il
  motivo.

Il codice è in `site/assets/js/studio/` e `site/app/studio.html`; l'app in `android/` (vedi `android/LEGGIMI.md`).

## 10. Limiti onesti

Polpo Studio è stato provato con test automatici, il Polpo virtuale e porte seriali simulate (pty), non con un
Polpo, adattatori Bluetooth, lettori NFC/125 kHz o schede Arduino veri. La versione nel telefono è provata nel
browser con lo schermo di un telefono e su un telefono Android emulato, non su un telefono vero con il cavo OTG. Le parti segnate **Sperimentali**
(aggiornamento firmware, lettore PC/SC, Polpo Bridge, iButton, app di terze parti) vanno provate con attenzione.
