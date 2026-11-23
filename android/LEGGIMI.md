# Polpo per Android

L'app per Android del Polpo: **Polpo Studio** per comandare il Polpo con un cavo USB OTG (o il Polpo virtuale, cioè
il firmware vero eseguito nel telefono) e tutto il sito del Polpo (simulatore, PolpoScript, Polpo Onde, manuali), **senza
Internet**: l'app non chiede nemmeno il permesso di collegarsi alla rete. Le pagine sono quelle di [`site/`](../site),
costruite con `site/build.py --app`; Studio è in [`site/assets/js/studio/`](../site/assets/js/studio) e
[`site/app/studio.html`](../site/app/studio.html).

## Com'è fatta

- Una sola schermata con una WebView ([`MainActivity.kt`](app/src/main/java/io/github/francesco209177/polpo/MainActivity.kt)).
- Le pagine stanno nell'APK e la WebView le chiede all'indirizzo `https://appassets.androidplatform.net/`,
  riservato da Android a questo uso: valgono le stesse regole del sito pubblicato (moduli JavaScript,
  WebAssembly, microfono). Ogni richiesta verso altri indirizzi viene rifiutata dall'app stessa; i link verso altri
  siti si aprono nel browser del telefono.
- Cosa la pagina può chiedere all'app (`PolpoNativo` in JavaScript, il contratto è [`PONTE.md`](PONTE.md)): la
  versione, cosa ha il telefono, i file del sito inclusi nell'app, il salvataggio di un file con il selettore di
  Android (la registrazione di Onde, lo zip per la microSD), i **dispositivi USB** collegati con un cavo OTG e la loro
  porta seriale, l'**NFC**, il **Bluetooth LE** e l'**emettitore infrarosso** del telefono. Gli esiti lenti arrivano con
  `window.__polpoNativo`. Niente altro: niente rete, niente emulazione di carte, niente annunci né scritture Bluetooth.
- La porta seriale ([`Seriale.kt`](app/src/main/java/io/github/francesco209177/polpo/Seriale.kt)) usa
  [usb-serial-for-android](https://github.com/mik3y/usb-serial-for-android) 3.11.0 (licenza MIT), con le regole di
  Polpo Studio per l'ESP32-S3: 115200 baud, DTR attivo e RTS basso, mai 1200 baud (riavvierebbe il Polpo nel
  bootloader). Altre schede possono chiedere un'altra velocità e altre linee; il tocco a 1200 baud per il bootloader
  c'è solo come comando a parte, per l'aggiornamento del firmware. Android chiede il permesso per ogni dispositivo;
  collegando il Polpo (Espressif) propone di aprire l'app.
- L'NFC ([`NfcTelefono.kt`](app/src/main/java/io/github/francesco209177/polpo/NfcTelefono.kt)) legge i tag in
  modalità lettore, solo con l'app in primo piano, e ne dà la stessa descrizione del comando `nfc.read` del Polpo
  ([`Carta.kt`](app/src/main/java/io/github/francesco209177/polpo/Carta.kt)); scrive un link o un testo NDEF solo su
  tag già formattati, scrivibili e senza blocchi, poi rilegge per verificare. Non formatta e non blocca mai un tag.
- Il Bluetooth LE ([`BleTelefono.kt`](app/src/main/java/io/github/francesco209177/polpo/BleTelefono.kt)): ricerca
  passiva e, per un dispositivo scelto, lettura delle caratteristiche e notifiche. Niente scritture né abbinamento.
- Gli infrarossi ([`Infrarossi.kt`](app/src/main/java/io/github/francesco209177/polpo/Infrarossi.kt)): solo se il
  telefono ha l'emettitore, 20–60 kHz, al massimo 1024 durate e 2 s.
- Polpo Link è lo stesso del programma per PC: ogni collegamento va accettato sullo schermo del Polpo, le
  trasmissioni e le scritture chiedono la modalità laboratorio e la conferma sul Polpo.
- Permessi chiesti al momento, con una spiegazione: il **microfono**, la prima volta che si preme «Ascolta» in Polpo
  Onde; **Dispositivi nelle vicinanze** (Android 12 e successivi, dichiarato «mai per la posizione») oppure la
  **posizione** (fino ad Android 11, che la pretende per la ricerca Bluetooth), la prima volta che una pagina cerca un
  dispositivo Bluetooth. NFC e infrarossi sono permessi senza domanda. L'USB non è un permesso dell'app: Android lo
  chiede al momento, per quel dispositivo. Tutto l'hardware è facoltativo: l'app si installa anche senza.
- I dati dell'app (bozze, microSD del Polpo simulato) restano nel telefono: niente backup sul cloud.
- Android 8.0 o più recente (minSdk 26), solo italiano. Librerie: AndroidX e usb-serial-for-android.

## Costruire l'app

Servono il JDK (17 o più recente), Gradle 8.14, l'SDK di Android (piattaforma 36) e Python con il pacchetto
`markdown`.

```sh
pip install markdown==3.11.3
android/prepara_sito.sh                # compila il firmware per il browser e costruisce le pagine
cd android
gradle assembleDebug                   # app/build/outputs/apk/debug/app-debug.apk
gradle testDebugUnitTest lintDebug     # prove e controlli
gradle connectedDebugAndroidTest       # prove su un emulatore o un telefono collegato
```

`prepara_sito.sh` accetta anche una cartella con `polpo-sim.wasm` già compilato (quella di
`polpo/sim/scripts/compila_web.sh`), per non ricompilarlo.

Le prove nel browser delle pagine dell'app, con lo schermo di un telefono:

```sh
cd site && APP_DIR=../android/app/build/sito npm run test:browser
```

## La firma

Android installa solo app firmate, e accetta un aggiornamento solo se è firmato **con la stessa chiave** della
versione installata. La chiave del progetto non sta nel repository: la usa solo GitHub, per le versioni pubblicate,
leggendola da due segreti del repository (*Settings › Secrets and variables › Actions*):

| Segreto | Contenuto |
|---|---|
| `POLPO_ANDROID_KEYSTORE` | il file della chiave (PKCS12, alias `polpo`) codificato in base64 |
| `POLPO_ANDROID_PASSWORD` | la sua password |

L'impronta SHA-256 del certificato è in [`certificato-sha256.txt`](certificato-sha256.txt) e sulla pagina
«Telefono» del sito: la pubblicazione si ferma se l'APK firmato non ha proprio quel certificato.

Chi costruisce l'app da sé la firma con la propria chiave di debug: funziona, ma non si può installare sopra la
versione pubblicata (e viceversa) senza prima disinstallarla.

## Prove

- `app/src/test`: le regole che trasformano un indirizzo nel file dentro l'APK (niente `..`, cartelle e
  `index.html`, tipi dei file); i messaggi NDEF (prefissi URI, testo, TLV) uguali a quelli del firmware; la carta
  dell'evento `nfc.tag` dai byte letti (modelli, famiglie, ATQA, pagine, errori) e quando non si scrive su un tag; gli
  annunci e i servizi Bluetooth; i limiti del ponte per la porta seriale, l'USB e gli infrarossi.
- `app/src/androidTest`, su emulatore in CI: l'app si apre, la pagina «Installa» è quella per il telefono, il
  simulatore accende il firmware vero ed esegue uno script, Polpo Studio si collega al Polpo virtuale dopo la conferma
  sul suo schermo, una richiesta verso Internet non parte, il ponte risponde anche senza NFC né infrarossi (e rifiuta
  ciò che esce dai limiti).
- `site/tests/e2e/app.test.mjs` e `studio.test.mjs`: le pagine dell'app in Chromium con lo schermo di un telefono, un
  finto `PolpoNativo` e il Polpo virtuale. [`site/tests/e2e/nativo_finto.mjs`](../site/tests/e2e/nativo_finto.mjs) è il
  finto completo di [`PONTE.md`](PONTE.md) (USB, NFC con un NTAG213 finto, Bluetooth LE con due dispositivi, infrarossi),
  con gli stessi messaggi dell'app.
- `site/tests/studio/`: il client Polpo Link (con il firmware vero) e la parità con Polpo Studio per PC: i casi di prova
  si generano dal codice Python e il JavaScript deve dare gli stessi risultati; la cassaforte apre i file e i backup
  `.polpobak` del programma per PC, e viceversa.

**Non è ancora stata provata su un telefono vero né con un Cardputer vero.**
