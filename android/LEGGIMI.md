# Polpo per Android

L'app per Android del Polpo. Questa prima versione contiene il sito del Polpo (simulatore con il firmware vero,
PolpoScript, Polpo Onde, manuali) e lo mostra **senza Internet**: l'app non chiede nemmeno il permesso di
collegarsi alla rete. Le pagine sono quelle di [`site/`](../site), costruite con `site/build.py --app`.

## Com'è fatta

- Una sola schermata con una WebView ([`MainActivity.kt`](app/src/main/java/io/github/francesco209177/polpo/MainActivity.kt)).
- Le pagine stanno nell'APK e la WebView le chiede all'indirizzo `https://appassets.androidplatform.net/`,
  riservato da Android a questo uso: valgono le stesse regole del sito pubblicato (moduli JavaScript,
  WebAssembly, microfono). Ogni richiesta verso altri indirizzi viene rifiutata dall'app stessa; i link verso altri
  siti si aprono nel browser del telefono.
- Cosa la pagina può chiedere all'app (`PolpoNativo` in JavaScript): la versione e il salvataggio di un file con il
  selettore di Android (la registrazione di Onde, lo zip per la microSD). Niente altro.
- Permessi: solo il **microfono**, chiesto la prima volta che si preme «Ascolta» in Polpo Onde.
- I dati dell'app (bozze, microSD del Polpo simulato) restano nel telefono: niente backup sul cloud.
- Android 8.0 o più recente (minSdk 26), solo italiano. Nessuna libreria oltre ad AndroidX.

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
  simulatore accende il firmware vero ed esegue uno script, una richiesta verso Internet non parte.
- `site/tests/e2e/app.test.mjs`: le pagine dell'app in Chromium con lo schermo di un telefono e un finto
  `PolpoNativo`.

**Non è ancora stata provata su un telefono vero.**
