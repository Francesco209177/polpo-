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
- Cosa la pagina può chiedere all'app (`PolpoNativo` in JavaScript): la versione, il salvataggio di un file con il
  selettore di Android (la registrazione di Onde, lo zip per la microSD) e la **porta seriale USB** del Polpo
  (`serialeElenco`, `serialeApri`, `serialeScrivi`, `serialeChiudi`; i dati arrivano con `window.__polpoNativo`).
  Niente altro.
- La porta seriale ([`Seriale.kt`](app/src/main/java/io/github/francesco209177/polpo/Seriale.kt)) usa
  [usb-serial-for-android](https://github.com/mik3y/usb-serial-for-android) 3.11.0 (licenza MIT), con le regole di
  Polpo Studio per l'ESP32-S3: 115200 baud, DTR attivo e RTS basso, mai 1200 baud (riavvierebbe il Polpo nel
  bootloader). Android chiede il permesso per ogni dispositivo; collegando il Polpo (Espressif) propone di aprire l'app.
- Polpo Link è lo stesso del programma per PC: ogni collegamento va accettato sullo schermo del Polpo, le
  trasmissioni e le scritture chiedono la modalità laboratorio e la conferma sul Polpo.
- Permessi: solo il **microfono**, chiesto la prima volta che si preme «Ascolta» in Polpo Onde. L'USB non è un
  permesso dell'app: Android lo chiede al momento, per quel dispositivo.
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
  `index.html`, tipi dei file).
- `app/src/androidTest`, su emulatore in CI: l'app si apre, la pagina «Installa» è quella per il telefono, il
  simulatore accende il firmware vero ed esegue uno script, Polpo Studio si collega al Polpo virtuale dopo la conferma
  sul suo schermo, una richiesta verso Internet non parte.
- `site/tests/e2e/app.test.mjs` e `studio.test.mjs`: le pagine dell'app in Chromium con lo schermo di un telefono, un
  finto `PolpoNativo` e il Polpo virtuale.
- `site/tests/studio/`: il client Polpo Link (con il firmware vero) e la parità con Polpo Studio per PC: i casi di prova
  si generano dal codice Python e il JavaScript deve dare gli stessi risultati; la cassaforte apre i file e i backup
  `.polpobak` del programma per PC, e viceversa.

**Non è ancora stata provata su un telefono vero né con un Cardputer vero.**
