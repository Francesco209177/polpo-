# PolpoNativo: cosa può chiedere la pagina all'app

Le pagine dell'app (WebView) parlano con il telefono solo attraverso l'oggetto JavaScript `PolpoNativo`
(`MainActivity.kt`). I metodi **sincroni** restituiscono una stringa (spesso JSON) o un booleano. Le operazioni
**lente** rispondono con eventi: l'app chiama `window.__polpoNativo({tipo, ...})` (in JavaScript:
`ascoltaNativo(fn)` in `site/assets/js/studio/link/trasporti.js`). I byte viaggiano in **base64**.

Regole che valgono per tutto il ponte:

- ogni accesso all'hardware chiede prima il permesso di Android, al momento, con una spiegazione;
- niente rete, niente emulazione di carte, niente annunci Bluetooth, niente scritture Bluetooth, niente invio di
  tasti come una tastiera: il ponte non ha metodi per farlo;
- ciò che trasmette o scrive (infrarossi, scrittura NFC, aggiornamento del firmware) lo chiede la pagina solo dopo la
  modalità laboratorio e una conferma; l'app controlla comunque i limiti scritti qui sotto.

## Generali

| Metodo | Risultato |
|---|---|
| `versione()` | versione dell'app, es. `"0.5.0"` |
| `telefono()` | JSON `{nfc, bluetooth, ir, usbHost}`: `nfc` e `bluetooth` valgono `"assente"`, `"spento"` o `"pronto"`; `ir` e `usbHost` sono booleani |
| `risorsaBase64(percorso)` | il contenuto di un file del sito incluso nell'app (percorso dalla radice, es. `"installa/polpo-cardputer-0.5.0-app.bin"`), in base64; `""` se non c'è |
| `salvaFile(nome, base64)`, `salvaRisorsa(percorso, nome)` | salvataggio con il selettore di Android |

## USB (cavo OTG)

| Metodo | Risultato |
|---|---|
| `usbElenco()` | JSON `[{id, nome, produttore, vid, pid, classi:[int], seriale, polpo, permesso}]`: tutti i dispositivi USB collegati; `seriale` = c'è un driver per usarlo come porta seriale; `polpo` = Espressif (VID 0x303A) |
| `serialeElenco()` | come sopra, solo quelli con `seriale: true` |
| `serialeApri(id, opzioni)` | `opzioni` JSON facoltativo `{baud: 115200, dtr: true, rts: false}`. 1200 baud è rifiutato. Chiede il permesso di Android se serve. Eventi: `seriale.aperta {nome}` oppure `seriale.errore {messaggio}` |
| `serialeScrivi(base64)` | `true` se scritto |
| `serialeLinee(dtr, rts)` | imposta le linee DTR e RTS; `true` se riuscito |
| `serialeBaud(baud)` | cambia velocità (1200 rifiutato); `true` se riuscito |
| `serialeToccoBootloader(id)` | apre e chiude il dispositivo a 1200 baud (DTR basso): l'ESP32-S3 con USB nativa riparte nel bootloader. Solo per l'aggiornamento del firmware. Evento `seriale.tocco {ok, messaggio}` |
| `serialeChiudi()` | chiude la porta aperta |

Eventi: `seriale.dati {dati}`, `seriale.chiusa {motivo: "scollegato" \| "porta chiusa"}`, `usb.cambiati` (dispositivo
collegato o staccato). Una porta seriale per volta.

## NFC del telefono

Solo lettura dei tag e scrittura NDEF (link o testo) su tag **propri**. Nessuna emulazione di carte (niente HCE),
nessun recupero di chiavi, nessuna scrittura di blocchi di protezione.

| Metodo | Risultato |
|---|---|
| `nfcAvvia()` | `true` se la lettura è partita (modalità lettore, finché la pagina non chiama `nfcFerma()` o l'app va in pausa) |
| `nfcFerma()` | ferma la lettura |
| `nfcScrivi(json)` | `{kind: "uri" \| "text", value, lang}` (`value` al massimo 400 byte): scrive sul prossimo tag appoggiato entro 20 s, solo se è già formattato NDEF, scrivibile e c'è spazio; poi rilegge per verificare |

Eventi:

- `nfc.tag {carta}`: `carta` ha la stessa forma della risposta `nfc.read` del Polpo, così l'analisi è la stessa:
  `{present: true, uid, atqa, sak, family, model?, version?, pages?, read_error?, tecnologie: [..]}` (`uid`,
  `version` e `pages` in esadecimale maiuscolo senza spazi; `pages` = memoria dalla pagina 0 per i tag NTAG/Ultralight)
- `nfc.scritto {bytes, model, uid}`, `nfc.errore {messaggio}`, `nfc.stato {stato: "pronto" \| "spento" \| "assente"}`

## Bluetooth LE del telefono

Scansione passiva e, per un dispositivo scelto, solo **lettura** delle caratteristiche e **notifiche**.

| Metodo | Risultato |
|---|---|
| `bleScansiona(ms)` | `ms` ≤ 10000. Evento `ble.risultato {devices: [{name, addr, rssi, mfr_id, connectable}]}` (la stessa forma della risposta `ble.scan` del Polpo) oppure `ble.errore {messaggio}` |
| `bleCollega(addr)` | evento `ble.collegato {addr, servizi: [{uuid, caratteristiche: [{uuid, proprieta: ["read", "notify", "indicate", "write", ...]}]}]}` oppure `ble.errore` |
| `bleLeggi(servizio, caratteristica)` | evento `ble.letto {servizio, caratteristica, dati}` |
| `bleNotifiche(servizio, caratteristica, attive)` | eventi `ble.notifica {servizio, caratteristica, dati}` |
| `bleScollega()` | evento `ble.scollegato {addr, motivo}` |

## Infrarossi del telefono

Solo se il telefono ha un emettitore infrarosso (pochi modelli).

| Metodo | Risultato |
|---|---|
| `irTrasmetti(frequenza, tempi)` | `tempi` = JSON di durate in µs, impulso e pausa alternati, primo = impulso. Rifiutato se il telefono non ha l'emettitore, oltre 1024 durate, oltre 2 s in tutto o con frequenza fuori da 20–60 kHz. `true` se trasmesso |
