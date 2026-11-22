# ESP Web Tools 10.1.0

Copia non modificata di `dist/web/` del pacchetto npm [`esp-web-tools`](https://www.npmjs.com/package/esp-web-tools)
versione 10.1.0 (licenza Apache-2.0, vedi `LICENSE`). Serve alla pagina **Installa** per scrivere il firmware sul
Cardputer dal browser. È ospitata qui, invece di essere caricata da un sito esterno, così il sito del Polpo non
fa richieste a terzi.

Impronta SHA-256 (base64) di `install-button.js`, uguale a quella pubblicata da unpkg:
`HoBbJeJR8uEdDiFzNOaViwBdMXvm6FpeuX34ozlonVo=`

Per aggiornarla: `npm pack esp-web-tools@<versione>`, sostituire i file `.js` e aggiornare questa nota e
`EWT_SHA256` in `site/build.py`.
