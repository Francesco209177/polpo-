# Polpo Studio — sicurezza

## Principi

* **Solo dispositivi tuoi o autorizzati.** Il programma non contiene funzioni per entrare in cancelli,
  veicoli, allarmi o sistemi di altre persone: niente disturbo radio, prove a forza bruta, rolling code,
  copie di badge o chiavi, emulazione di carte, attacchi Wi-Fi/Bluetooth, avvio dal PC degli script BadUSB
  (quelli che scrivono come una tastiera).
  Queste funzioni compaiono nei moduli come **Non disponibile**, con il motivo.
* **Mai fingere hardware assente.** Lo stato di ogni funzione dipende da cosa è davvero collegato; il Polpo
  virtuale è sempre segnato **SIMULATO** e i suoi dati non si inviano al Polpo vero (anche un telecomando
  personale diventa SIMULATO se gli si aggiunge un tasto imparato dal Polpo virtuale).
* **Doppia conferma** per ciò che cambia il mondo reale: modalità laboratorio + conferma sul PC, e per
  trasmissioni, scritture di tag e script anche la conferma sullo schermo del Polpo (predefinito No, 20 s).

## Cassaforte cifrata

| Elemento | Come |
|---|---|
| Chiave dati | 256 bit casuali; cifra file e indice con **AES-256-GCM** (libreria `cryptography`) |
| Frase di accesso e chiave di recupero | Ognuna "avvolge" la chiave dati con una chiave ricavata con **scrypt** (N = 2^17, r = 8, p = 1, sale casuale) |
| File e indice | Dati aggiuntivi autenticati con id e versione: un file scambiato o riportato a una versione vecchia non passa la verifica |
| Integrità | *Verifica integrità* decifra tutto e confronta le impronte SHA-256; segnala file mancanti, alterati o estranei |
| PIN | Solo blocco rapido mentre il programma è aperto: senza la chiave dati in memoria non apre nulla. Dopo 5 errori la chiave viene tolta dalla memoria |
| Blocco automatico | Dopo un tempo di inattività (predefinito 10 minuti) |
| "Ricorda su questo computer" | Facoltativo: chiave dati nel portachiavi del sistema. Comodo ma meno sicuro: chi usa il tuo account del computer può aprire la cassaforte |

Limiti: Python non garantisce di cancellare ogni copia della chiave dalla memoria; i file **esportati** e i
**report** non sono cifrati (il programma lo ricorda ogni volta).

## Registro attività

Ogni voce è cifrata e porta l'HMAC-SHA256 della voce precedente (catena). Un file di "testa" cifrato ricorda
l'ultima voce: *Verifica integrità* scopre voci cambiate, tolte, riordinate o tagliate in fondo.

## Copie di sicurezza `.polpobak`

Tutto il contenuto della cassaforte in un file cifrato (AES-256-GCM) con una **password a parte**
(scrypt), così si ripristina anche su un altro computer. Il ripristino controlla le impronte e salta i
file già presenti.

## Nel telefono (app per Android)

Polpo Studio nell'app per Android usa **la stessa cassaforte**, con gli stessi formati: le chiavi vengono da
WebCrypto (AES-256-GCM, HKDF, HMAC-SHA256, SHA-256) e da scrypt della libreria
[@noble/hashes](https://www.npmjs.com/package/@noble/hashes) 2.4.0 (copiata nell'app con l'impronta di ogni file).
I dati stanno nella memoria dell'app (IndexedDB), che Android esclude dai backup sul cloud. Le prove automatiche
aprono nel telefono cassaforti, registri e backup creati dal programma per PC e viceversa, e controllano che le
manomissioni siano segnalate allo stesso modo. «Ricorda su questo computer» non c'è ancora nel telefono: serve
sempre la frase (o il PIN per il blocco rapido). Anche nel telefono i file esportati e i report non sono cifrati.

## Modalità laboratorio

Serve per: trasmettere a 433 MHz, scrivere tag NFC, aggiornare il firmware del Polpo, programmare schede ESP32,
pilotare uscite GPIO, usare app di terze parti. Si attiva accettando le regole e confermando con PIN o frase;
si spegne da sola (predefinito 30 minuti), al blocco dello schermo e alla chiusura del programma.

## Programmi PolpoScript

Le mini-app in PolpoScript (modulo Script) non sono script BadUSB: il linguaggio ha solo funzioni per disegnare,
suonare, leggere i tasti, contare il tempo e tenere piccoli file in `/polpo/script/dati`. **Non esistono** funzioni
per trasmettere (radio, infrarossi, NFC), scrivere come una tastiera USB, usare Bluetooth o Wi-Fi: un programma che
trasmette dentro un ciclo servirebbe a provare codici a raffica. Il firmware lo garantisce in tre modi: un test fissa
l'elenco delle funzioni del linguaggio; `polpo/scripts/check_script.py` (in CI) controlla che il codice che esegue gli
script non includa i moduli che trasmettono; Polpo Link accetta da avviare solo file `.polpo` di `/polpo/script`.
L'avvio dal PC chiede sempre conferma sullo schermo del Polpo e il tasto G0 ferma sempre il programma. Ogni programma
ha memoria e tempo di calcolo limitati: non può bloccare il Polpo né riempirne la memoria.

## App di terze parti

Si installano e si aprono solo in modalità laboratorio, sono **Sperimentali** e **non isolate**: il loro codice
gira con gli stessi permessi di Polpo Studio. I permessi del manifest limitano solo ciò che passa dall'interfaccia
`AppApi` (nessun permesso concede trasmissioni o scritture). All'installazione si registra l'impronta SHA-256 di
ogni file: un'app modificata dopo l'installazione non si apre più.

## Aggiornamento del firmware

Usa solo il file incluso nel programma, con impronta SHA-256 fissata nel codice; nessun aggiornamento automatico.
