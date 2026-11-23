# esptool-js 0.7.1

Copia **non modificata** di `bundle.js` del pacchetto npm [`esptool-js`](https://www.npmjs.com/package/esptool-js)
versione 0.7.1 (pubblicata il 02/11/2026, licenza Apache-2.0, vedi `LICENSE`), di Espressif Systems. `NOTICE`
riporta gli avvisi di licenza del codice di terzi contenuto nel file (pako 2.1.0, licenza MIT e Zlib).

Serve a `assets/js/studio/aggiornamento/firmware.js`: l'app per Android aggiorna il firmware del Polpo (ESP32-S3)
dal telefono, con il cavo USB OTG, attraverso il ponte `PolpoNativo` (`aggiornamento/porta.js` fa da porta seriale
«come Web Serial» per la classe `Transport` di esptool-js). È ospitata qui, invece di essere caricata da un sito
esterno, così il sito e l'app non fanno richieste a terzi.

Perché proprio `bundle.js` e non i file di `lib/`:

- è un unico modulo ES senza `import`: funziona nel browser senza bundler. I file di `lib/` importano invece `pako` e
  `atob-lite` per nome (servirebbe una mappa degli import o modificarli) e caricano gli stub con `import()` di file
  JSON;
- contiene già i programmi di scrittura («stub», `lib/targets/stub_flasher/*.json`) di tutti i chip, incorporati da
  rollup: niente viene scaricato o caricato a parte, funziona anche senza rete. Lo stub per l'ESP32-S3 è identico a
  `lib/targets/stub_flasher/esp32s3.json` del pacchetto (controllato: SHA-256 del codice
  `c37a7d12…29741374`, dei dati `75be8e20…ed14df93`, entrata `0x40379524`);
- contiene anche `pako` 2.1.0 (compressione dei dati da scrivere); `atob-lite` nel browser è solo il `atob` globale.
  Nessun'altra dipendenza da copiare.

Nel file compaiono un indirizzo `https://` (nel commento di licenza di pako) e il codice WebUSB di esptool-js
(`navigator.usb`, non usato qui): il codice non fa richieste di rete. Per questo il controllo di `site/build.py` sui
file `.js` vale per questa cartella solo attraverso `INTEGRITA.json`, l'impronta SHA-256 (esadecimale) di ogni file.

Provenienza: `npm pack esptool-js@0.7.1`, archivio `esptool-js-0.7.1.tgz` del registro npm con integrità
`sha512-vw1isT5ROHgpRmMG3y6B81dceeZ7O1WhF1x05qFbAlH8N0N/pOQqODzJLA+36lCbOXCw06iA4CWctyrQQ7VeSA==`
(verificata qui; il registro lo dà pubblicato da GitHub Actions, dal commit `d5b779b0`, con un'attestazione di
provenienza che qui non è stata controllata). Il testo di `NOTICE`
viene da `pako@2.1.0` (`LICENSE` e intestazione di `lib/zlib/deflate.js`) e `atob-lite@2.0.0` (`LICENSE.md`).

Cosa `aggiornamento/firmware.js` fa diversamente da esptool-js, senza toccarne i file (i motivi sono nel suo
commento iniziale): ferma i watchdog quando la ROM usa l'USB-Serial-JTAG, toglie `FORCE_DOWNLOAD_BOOT` prima del
reset, usa un reset finale con RTS alto e poi basso, nasconde `getChipRevision` ereditata dall'ESP32. Le prove in
`site/tests/studio/aggiornamento/` controllano l'impronta dei file e fanno una scrittura completa con esptool-js
contro un ESP32-S3 finto.

Per aggiornarla: `npm view esptool-js time` (una versione pubblicata da almeno due settimane), `npm pack
esptool-js@<versione>`, controllare l'integrità con `npm view esptool-js@<versione> dist.integrity`, copiare
`bundle.js` e `LICENSE` in una cartella `esptool-js-<versione>/`, rifare `NOTICE` e `INTEGRITA.json`, aggiornare
l'import in `aggiornamento/firmware.js`, le prove e questa nota; rileggere `lib/webserial.js` (cosa usa di
SerialPort), `lib/reset.js` e `lib/targets/esp32s3.js` (le differenze qui sopra potrebbero non servire più).
