# Protocollo di Polpo Onde

Polpo Onde trasmette brevi messaggi di testo tra due dispositivi usando il suono: l'altoparlante di uno e il
microfono dell'altro. Questa è la specifica completa del profilo **Robusto**, versione 1: con questi numeri si può
scrivere un trasmettitore o un ricevitore compatibile in qualsiasi linguaggio.

Il codice di riferimento è in `site/assets/js/onde/` (JavaScript senza librerie) e le prove in `site/tests/onde/`.

> **Stato: sperimentale.** Il modem è verificato con prove automatiche in un canale **simulato**. Nell'aria vera non
> è ancora stato provato in modo sistematico.

## In breve

| Voce | Valore |
|---|---|
| Banda | 1600 – 3150 Hz |
| Modulazione | 16-FSK: una nota alla volta, 4 bit per nota |
| Note | 32 frequenze a passi di 50 Hz, divise in due banchi da 16 usati a turno |
| Durata di una nota (simbolo) | 60 ms, con salita e discesa di 4 ms |
| Velocità | 16,7 note al secondo, circa 33 bit utili al secondo con la correzione al 50% |
| Sincronizzazione | un fischio che sale e uno che scende (chirp lineari di 100 ms) |
| Correzione degli errori | Reed–Solomon su GF(256), fino a metà dei byte di parità |
| Controllo | CRC-8 sull'intestazione, CRC-16 sul testo |
| Testo | UTF-8, da 1 a 120 byte |
| Durata di una trama | «Ciao!» 3,7 s · 32 byte 10 s · 120 byte 24 s |

Tutte le grandezze sono in hertz e secondi: il protocollo non dipende dalla frequenza di campionamento dei
dispositivi (44,1 kHz, 48 kHz o altro).

## Le note

Le frequenze sono `1600 + 50·k` Hz con `k = 0 … 31`.

- **Banco A**: `k` pari, cioè `1600 + 100·j` Hz (`j = 0 … 15`).
- **Banco B**: `k` dispari, cioè `1650 + 100·j` Hz.

I simboli si contano da `i = 0` (il primo simbolo di addestramento). Il simbolo `i` usa il banco A se `i` è pari,
il banco B se è dispari: così l'eco di una nota cade sempre in un banco che il ricevitore, in quel momento, non
sta guardando.

Dentro il banco, il valore di 4 bit `v` viene trasmesso sul tono

```
j = (v + salto(i)) mod 16
salto(i) = (7 · ⌊i/2⌋) mod 16          se i è pari
salto(i) = (11 · ⌊i/2⌋ + 5) mod 16     se i è dispari
```

I primi sedici salti sono `0 5 7 0 14 11 5 6 12 1 3 12 10 7 1 2`. Il salto fa sì che uno stesso valore ripetuto
non occupi sempre la stessa frequenza: un punto "sordo" della stanza o un disturbo fisso rovinano note sparse, che
il codice di correzione ripara, invece di colpire sempre lo stesso valore.

Ogni nota è una sinusoide di 60 ms moltiplicata per un inviluppo a coseno rialzato (4 ms di salita, 4 di discesa).
Il ricevitore di riferimento ignora i primi 20 ms di ogni simbolo e misura l'energia sui 40 ms restanti con una
finestra di Hann: a quella durata tutte le 32 frequenze sono ortogonali tra loro.

## La trama

| Parte | Durata | Contenuto |
|---|---|---|
| Avvio | 250 ms | tono a 1000 Hz a un quarto dell'ampiezza: "sveglia" altoparlante e microfono |
| Fischio che sale | 100 ms | chirp lineare da 1600 a 3150 Hz |
| Pausa | 20 ms | silenzio |
| Fischio che scende | 100 ms | chirp lineare da 3150 a 1600 Hz |
| Silenzio | 60 ms | lascia spegnere l'eco dei fischi |
| Addestramento | 8 simboli | valori noti `0 15 5 10 3 12 6 9` |
| Intestazione | 14 simboli | 7 byte: 3 utili + 4 di parità |
| Dati | 2·n simboli | n byte: testo + CRC-16 + parità |
| Coda | 30 ms | silenzio |

Ogni byte diventa due simboli: prima i 4 bit alti, poi i 4 bassi.

Il chirp di durata `T = 0,1 s` tra le frequenze `f0` e `f1` ha fase `2π·(f0·t + (f1 − f0)·t² / (2T))`, con lo stesso
inviluppo di 4 ms delle note. La distanza tra gli inizi dei due fischi è 120 ms; il primo simbolo comincia 280 ms
dopo l'inizio del primo fischio.

### Intestazione

```
byte 0 = versione · 16 + profilo        (versione 1, profilo 0 = Robusto → 0x10)
byte 1 = lunghezza del testo in byte    (1 … 120)
byte 2 = CRC-8 dei byte 0 e 1
byte 3 … 6 = parità Reed–Solomon (4 byte: corregge 2 byte sbagliati)
```

### Dati

```
testo (L byte, UTF-8)
CRC-16 di [byte 0, byte 1, testo], prima il byte alto     ← lega il testo alla sua intestazione
parità Reed–Solomon (P byte)
```

Con `k = L + 2`, i byte di parità sono `P = min(64, max(8, k arrotondato al pari superiore))`: per i messaggi fino
a 62 byte la parità è lunga quanto i dati, e il codice ripara fino a un quarto dei byte trasmessi.

## Codici

- **CRC-8**: polinomio `0x07`, valore iniziale `0x00`, nessuna inversione. Per `123456789` vale `0xF4`.
- **CRC-16/CCITT-FALSE**: polinomio `0x1021`, valore iniziale `0xFFFF`, nessuna inversione. Per `123456789` vale `0x29B1`.
- **Reed–Solomon** su GF(2⁸) con polinomio primitivo `0x11D` e generatore α = 2; il polinomio generatore del codice
  ha radici α⁰ … α^(P−1); codice sistematico (dati seguiti dalla parità). Sono le stesse scelte dei codici QR:
  i dati `32 91 11 120 209 114 220 77 67 64 236 17 236 17 236 17` con 10 byte di parità danno
  `196 35 39 119 235 215 231 226 93 23`.

Il ricevitore corregge errori e cancellature (`2·errori + cancellature ≤ P`): i byte le cui note sono risultate
incerte vengono indicati come cancellature, che costano la metà di un errore.

## Vettore di prova

Il messaggio `Ciao!` (5 byte):

```
intestazione   10 05 4c f8 12 f3 40
dati           43 69 61 6f 21 53 a7 bf 18 a2 e2 35 88 9e 35
```

Frequenze delle 52 note, in hertz, nell'ordine di trasmissione:

```
1600 2050 2800 2650 1700 2350 2700 3150                                  addestramento
2900 1750 1900 1750 3000 1950 1600 2650 2500 3150 3000 2750 2600 1950    intestazione
1700 1750 2600 1850 1700 2150 2400 3050 2700 2750 2100 2450 1700 2350
2500 2650 2200 3050 2200 1950 1700 3050 2900 2850 2500 2650 1700 2750
1800 2950                                                                dati
```

Intestazione e dati sono stati ricalcolati con un'implementazione indipendente di Reed–Solomon (la libreria Python
`reedsolo`), che ha dato gli stessi byte.

## Il ricevitore di riferimento

1. Porta l'audio a 8 kHz con un filtro che lascia passare solo 1,3 – 3,45 kHz.
2. Cerca i due fischi con un filtro adattato (correlazione normalizzata, in fase e in quadratura). Il punto di
   mezzo tra i due picchi dà il tempo anche se i due orologi hanno frequenze leggermente diverse, perché uno
   scarto di frequenza sposta i due picchi in versi opposti.
3. Conferma l'aggancio sugli 8 simboli noti (ne servono almeno 5) e rifinisce il tempo entro ±6 ms.
4. Per ogni simbolo misura l'energia dei 16 toni del banco e la divide per il rumore di quel tono (la mediana
   della sua energia su tutta la trama): un disturbo fisso su una frequenza non viene scambiato per una nota.
5. Insegue l'orologio di chi trasmette confrontando l'energia appena prima e appena dopo i bordi di ogni simbolo.
6. Toglie l'eco stimata delle note di due e quattro simboli prima (stesso banco), poi decide.
7. Se tre simboli di fila sono illeggibili cerca un nuovo allineamento entro mezzo simbolo: recupera i casi in
   cui il dispositivo ha perso dei campioni.
8. Prova la correzione con un numero crescente di cancellature, scelte tra i byte meno sicuri, e accetta il
   risultato solo se il CRC coincide.

## Risultati nel canale simulato

Questi sono i minimi che le prove automatiche pretendono a ogni modifica. Valgono per il **modello** di canale in
`canale.js`, non per una stanza vera.

| Condizione | Messaggi arrivati |
|---|---|
| Rumore bianco, segnale da 20 dB sopra fino a pari al rumore (in banda) | tutti |
| Rumore 3 dB più forte del segnale | almeno 23 su 25 |
| Riverbero di 0,5 s, suono diretto pari al riverbero, rumore a 10 dB | almeno 39 su 40 |
| Riverbero di 0,8 s, suono diretto 6 dB sotto il riverbero | almeno la metà |
| Orologi diversi fino allo 0,5%, velocità che oscilla | tutti |
| 44,1 kHz ↔ 48 kHz, 16 kHz, 96 kHz | tutti |
| Altoparlante piccolo, distorsione forte, guadagno automatico, volume da −60 a +20 dB | tutti |
| Un tono fisso forte come il segnale; tre toni fissi 6 dB più forti | tutti; almeno 19 su 20 |
| 30 ms di audio persi a metà messaggio | almeno 18 su 20 |
| Dieci minuti di rumore, note casuali, fischi casuali, voce sintetica, preamboli senza dati | nessun messaggio inventato |

In nessuna prova un messaggio è arrivato con un testo diverso da quello spedito: quando il canale è troppo
difficile il messaggio viene scartato.

## Cosa non è

- Non è cifrato: chiunque sia nella stanza con un ricevitore compatibile legge il messaggio.
- Non è pensato per essere nascosto o inudibile: le note si sentono, apposta.
- Non conferma la ricezione: chi trasmette non sa se il messaggio è arrivato.

## Riservatezza

La pagina del sito elabora l'audio del microfono nel browser. Non lo invia e non lo salva. Il codice del sito non
contiene funzioni di rete, e la costruzione del sito fallisce se qualcuno ne aggiunge.
