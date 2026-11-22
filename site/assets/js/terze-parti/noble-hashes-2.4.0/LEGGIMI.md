# @noble/hashes 2.4.0 (solo scrypt)

Copia **non modificata** di sette file del pacchetto npm [`@noble/hashes`](https://www.npmjs.com/package/@noble/hashes)
versione 2.4.0 (pubblicata il 27/08/2026, licenza MIT, vedi `LICENSE`), di Paul Miller.

Serve a `assets/js/studio/sicurezza/cripto.js`: la cassaforte e i backup `.polpobak` di Polpo Studio ricavano le
chiavi con **scrypt** (N = 2^17, r = 8, p = 1), che WebCrypto non offre. Tutto il resto (AES-GCM, HKDF, HMAC,
SHA-256) viene da WebCrypto. È ospitata qui, invece di essere caricata da un sito esterno, così il sito e l'app non
fanno richieste a terzi.

| File | Perché |
|---|---|
| `scrypt.js` | `scryptAsync`, la versione che ogni tanto restituisce il controllo alla pagina |
| `pbkdf2.js`, `hmac.js`, `sha2.js`, `_md.js`, `_u64.js`, `utils.js` | importati da `scrypt.js` (PBKDF2-HMAC-SHA256) |

Provenienza: `npm pack @noble/hashes@2.4.0`, archivio `hashes-2.4.0.tgz` del registro npm con integrità
`sha512-X5XaVWZIBCT7HHZGm5I7ZQXDwLG+bGXuSrMQAW+7Zvl87h1kmc1ZB1VSRJcpUfoUrGQp4Fkoxm5kZ+Ms+aW+eA==`
(verificata). I file sono moduli ES con import relativi (`./utils.js`): funzionano nel browser senza bundler.
Nei commenti compaiono indirizzi `https://` (riferimenti alla documentazione): il codice non fa richieste di rete.

`INTEGRITA.json` riporta l'impronta SHA-256 (esadecimale) di ogni file copiato; la prova
`site/tests/studio/sicurezza/terze_parti.test.mjs` la controlla e verifica scrypt con i vettori di RFC 7914.

Per aggiornarla: `npm pack @noble/hashes@<versione>` (una versione pubblicata da almeno due settimane), controllare
l'integrità con `npm view @noble/hashes@<versione> dist.integrity`, copiare gli stessi file in una cartella
`noble-hashes-<versione>/`, rifare `INTEGRITA.json`, aggiornare l'import in `cripto.js` e questa nota.
