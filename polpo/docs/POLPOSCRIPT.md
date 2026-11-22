# PolpoScript — il linguaggio del Polpo

PolpoScript è un piccolo linguaggio **in italiano** per scrivere mini-app: giochi, cronometri, dadi, strumenti.
Si scrive come si parla: `se … allora`, `ripeti 3 volte`, `fine`.

> **Stato.** Il linguaggio è coperto da prove automatiche: una raccolta di programmi con il risultato atteso e
> centinaia di migliaia di programmi casuali o rovinati, che non devono mai mandare in crisi il Polpo.
> Il linguaggio c'è dalla versione **0.2.0** del firmware: app «Script» sul Polpo, riquadro «Script» nel
> [simulatore del sito](https://francesco209177.github.io/polpo-/simulatore/) e modulo «Script» di Polpo Studio.
> Come tutto il firmware, **non è ancora stato provato su un Cardputer vero**.

## Il primo programma

```
scrivi("Ciao!")
```

E una pallina che rimbalza:

```
x = 120
vx = 2
ripeti sempre
  pulisci()
  cerchio(x, 60, 5, ROSSO)
  x = x + vx
  se x > 235 oppure x < 5 allora
    vx = -vx
    suona(880, 30)
  fine
  mostra()
  aspetta(30)
fine
```

Il tasto **G0** ferma sempre il programma.

## Dove si mettono i programmi

Un programma è un file di testo con il nome che finisce in **`.polpo`**, nella cartella **`/polpo/script`** della
microSD. Si scrive con un qualsiasi editor di testo (Blocco note, Gedit…) e si esegue dal menu **Script** del Polpo.
Al primo avvio il Polpo ci mette quattro esempi: `pallina`, `indovina`, `dado` e `serpente`.

Per provare senza dispositivo c'è il riquadro **Script** del
[simulatore del sito](https://francesco209177.github.io/polpo-/simulatore/): scrivi il programma, premi **Esegui** e
lo vedi girare sul Polpo simulato; con **Una riga alla volta** lo segui passo passo guardando le variabili.

## Le regole in breve

- **Un'istruzione per riga.** I rientri (gli spazi a inizio riga) servono solo a leggere meglio.
- **Maiuscole e accenti non contano** nelle parole e nei nomi: `Se`, `SE` e `se` sono la stessa cosa, come
  `finché` e `finche`, `velocità` e `velocita`. Così si scrive bene anche dalla tastiera del Cardputer.
- **Commenti:** tutto ciò che segue `#` su una riga viene ignorato.
- Ogni blocco (`se`, `ripeti`, `per`, `funzione`) si chiude con **`fine`**.
- Gli elementi di liste e testi si contano **da 1**: il primo è il numero 1.

## Valori

| Tipo | Esempi |
|---|---|
| numero | `42`, `3.14`, `-7` (il punto separa i decimali) |
| testo | `"Ciao"`, `'anche così'`; dentro un testo `\n` va a capo, `\"` è una virgoletta |
| vero / falso | `vero`, `falso` |
| lista | `[1, 2, 3]`, `["a", [1, 2]]`, `[]` |
| niente | `niente` (nessun valore: è ciò che dà una funzione senza `ritorna`) |

I numeri si scrivono con al massimo 15 cifre. Quando vengono mostrati hanno al massimo sei cifre dopo il punto
(`1 / 3` si legge `0.333333`).

## Variabili

```
punti = 0
nome = "Ada"
punti = punti + 10
punti += 5        # anche -=  *=  /=
```

Una variabile nasce quando le dai un valore e vale **in tutto il programma**, anche dentro le funzioni.
Usarla prima di averle dato un valore è un errore.

## Operazioni

| | |
|---|---|
| `+  -  *  /` | le quattro operazioni; `/` dà anche i decimali (`7 / 2` fa `3.5`) |
| `%` | resto della divisione (`7 % 3` fa `1`) |
| `==  !=  <  <=  >  >=` | confronti; dentro una condizione anche `=` da solo vuol dire «uguale» |
| `e`, `oppure` (o `o`), `non` | per combinare condizioni |

`+` unisce anche i testi: `"Punti: " + punti` dà `Punti: 15`. Unisce anche due liste.
Dividere per zero ferma il programma con un errore.

## Condizioni

```
se punti >= 100 allora
  scrivi("Hai vinto!")
altrimenti se punti >= 50 allora
  scrivi("Ci sei quasi")
altrimenti
  scrivi("Continua")
fine
```

Forma corta, su una riga e senza `fine`: `se vite == 0 allora termina()`

Dopo `se` ci vuole qualcosa che sia **vero o falso** (un confronto, per esempio): un numero da solo non basta.

## Cicli

```
ripeti 5 volte
  scrivi("ciao")
fine

ripeti finché vite > 0        # continua finché la condizione è vera
  vite = vite - 1
fine

ripeti sempre                 # non finisce da solo: si esce con «esci» o con G0
  se tasto() == "ok" allora esci
fine

per i da 1 a 10               # conta da 1 a 10
  scrivi(i)
fine

per i da 10 a 0 passo -2      # 10, 8, 6 … 0
  scrivi(i)
fine

per ogni frutto in ["mela", "pera"]     # anche: per ogni lettera in "ciao"
  scrivi(frutto)
fine
```

Dentro un ciclo: **`esci`** lo interrompe, **`continua`** salta al giro successivo.

## Funzioni

```
funzione area(base, altezza)
  ritorna base * altezza
fine

scrivi(area(3, 4))
```

- Si possono usare anche prima del punto in cui sono definite. Si definiscono fuori da tutto il resto.
- I nomi tra parentesi valgono solo dentro la funzione.
- Per una variabile che deve valere solo dentro la funzione: `locale provvisorio = 5`.
- Senza `ritorna`, la funzione dà `niente`.
- Una funzione può richiamare sé stessa, fino a una trentina di volte una dentro l'altra.

## Liste

```
spesa = ["pane", "latte"]
aggiungi(spesa, "uova")
scrivi(spesa[1])            # pane
spesa[2] = "tè"
scrivi(lunghezza(spesa))    # 3
```

Due nomi possono indicare **la stessa lista**: dopo `b = a`, aggiungere un elemento a `b` lo aggiunge anche ad `a`.

## Funzioni già pronte

### Schermo (240 × 135 punti; `x` da sinistra, `y` dall'alto)

| | |
|---|---|
| `pulisci()` · `pulisci(colore)` | cancella tutto |
| `punto(x, y, colore)` | un punto |
| `linea(x1, y1, x2, y2, colore)` | una linea |
| `rettangolo(x, y, larghezza, altezza, colore)` | rettangolo pieno; `cornice(…)` solo il bordo |
| `cerchio(x, y, raggio, colore)` | cerchio pieno; `anello(…)` solo il bordo |
| `scritta(x, y, cosa, colore)` · `scritta(x, y, cosa, colore, grandezza)` | un testo sullo schermo; grandezza da 1 a 4 |
| `mostra()` | mostra il disegno finito: nei giochi, una volta per fotogramma |
| `scrivi(cosa, …)` | scrive una riga, come su un foglio |
| `colore(rosso, verde, blu)` | un colore a piacere; ogni valore va da 0 a 255 |

Colori pronti: `NERO BIANCO ROSSO VERDE BLU GIALLO ARANCIO AZZURRO VIOLA ROSA GRIGIO MARRONE`.
Misure dello schermo: `LARGHEZZA_SCHERMO` (240) e `ALTEZZA_SCHERMO` (135).

I colori e gli altri valori pronti non si possono usare come nomi per le proprie variabili (`rosso = 5` è un errore).

### Tasti

| | |
|---|---|
| `tasto()` | il prossimo tasto premuto, oppure `niente` se non ce ne sono: non aspetta |
| `aspetta_tasto()` | aspetta un tasto e lo dà |
| `premuto("sinistra")` | `vero` se quel tasto è tenuto premuto in questo momento |
| `chiedi("Come ti chiami?")` | fa scrivere una riga e la dà come testo |

Nomi dei tasti: una lettera o una cifra (`"a"`, `"7"`) oppure `"su"`, `"giu"`, `"sinistra"`, `"destra"`, `"ok"`,
`"indietro"`, `"spazio"`, `"canc"`, `"tab"`.

### Suoni e tempo

| | |
|---|---|
| `suona(nota, millisecondi)` | un suono; la nota è in hertz (440 è un La) |
| `aspetta(millisecondi)` | una pausa |
| `tempo()` | millisecondi passati dall'inizio del programma |

### Numeri

| | |
|---|---|
| `casuale(6)` | un numero intero a caso da 1 a 6 |
| `casuale(10, 20)` | a caso da 10 a 20 |
| `casuale()` | a caso tra 0 e 1, con i decimali |
| `seme(n)` | fa ripartire i numeri a caso sempre dalla stessa sequenza |
| `intero(x)` | toglie i decimali (`intero(3.7)` fa `3`) |
| `arrotonda(x)` | all'intero più vicino |
| `assoluto(x)` | senza il segno meno |
| `minimo(a, b, …)` · `massimo(a, b, …)` | il più piccolo, il più grande (anche di una lista) |
| `radice(x)` | radice quadrata |
| `seno(gradi)` · `coseno(gradi)` | con l'angolo in gradi; `PI_GRECO` vale 3.141593 |

### Testi

| | |
|---|---|
| `lunghezza(t)` | quante lettere (o quanti elementi, per una lista) |
| `parte(t, da)` · `parte(t, da, quante)` | un pezzo del testo: `parte("polpo", 2, 3)` dà `olp` |
| `t[3]` | la terza lettera |
| `trova(t, cosa)` | la posizione in cui compare, oppure 0 |
| `maiuscolo(t)` · `minuscolo(t)` | |
| `dividi(t, separatore)` | una lista con i pezzi: `dividi("a,b", ",")` |
| `unisci(lista, separatore)` | il contrario |
| `testo(x)` | trasforma in testo |
| `numero(t)` | trasforma in numero (`"3,5"` e `"3.5"` vanno bene); se non è un numero dà `niente` |
| `tipo(x)` | `"numero"`, `"testo"`, `"lista"`, `"vero/falso"` o `"niente"` |

### Liste

| | |
|---|---|
| `aggiungi(lista, valore)` | in fondo |
| `inserisci(lista, posizione, valore)` | in mezzo |
| `togli(lista, posizione)` · `togli(lista)` | toglie (senza posizione: l'ultimo) e dà l'elemento tolto |
| `trova(lista, valore)` | la posizione, oppure 0 |
| `lista(n)` · `lista(n, valore)` | una lista di `n` elementi tutti uguali |
| `ordina(lista)` | mette in ordine numeri o testi (le maiuscole vengono prima delle minuscole) |

### File e programma

| | |
|---|---|
| `salva("record.txt", valore)` | scrive un piccolo file di testo; dà `vero` se ci è riuscito |
| `carica("record.txt")` | lo rilegge come testo; se non esiste dà `niente` |
| `termina()` | chiude il programma |

I file stanno in una cartella riservata agli script sulla microSD. Il nome può avere solo lettere, cifre,
`_`, `-` e `.` (al massimo 24 caratteri): uno script non può leggere o scrivere altrove.

## Cosa uno script non può fare, per scelta

Non esistono funzioni per **trasmettere** via radio, infrarossi o NFC, per **scrivere come una tastiera USB**,
né per usare **Bluetooth o Wi-Fi**. Un programma che trasmette dentro un ciclo sarebbe uno strumento per provare
codici a raffica, cioè proprio ciò che il Polpo esclude. Una prova automatica controlla che l'elenco delle
funzioni pronte resti quello di questa pagina.

## Limiti

Pensati perché nessun programma possa bloccare o riempire il Polpo:

| | |
|---|---|
| lunghezza del programma | 16.000 caratteri |
| variabili | 128 |
| un testo | 2.048 caratteri |
| una lista | 1.024 elementi |
| testi e liste tutti insieme | circa 32 KB |
| blocchi uno dentro l'altro | 10 |
| funzioni una dentro l'altra | 31 |

Superare un limite ferma il programma con un messaggio che lo spiega.

## Errori

Gli errori sono in italiano e dicono la riga:

```
Riga 7: non conosco la funzione «cerhio». Forse volevi «cerchio»?
Riga 3: manca «fine» per chiudere «se» della riga 1
Riga 12: la variabile «pnti» non ha ancora un valore: dagliene uno prima di usarla
Riga 5: non posso sommare un numero e una lista
```

## Per chi sviluppa

Il linguaggio è implementato una volta sola, in `polpo/lib/polpo_core/src/polpo/script/`: `lexer` (parole),
`compiler` (istruzioni per la macchina virtuale, in una sola passata), `vm` e `natives` (esecuzione e funzioni
pronte), `numbers` (numeri identici su ogni piattaforma, senza `printf` né `sin` di libreria), `transcript`
(esecuzione "a verbale" per le prove). La macchina virtuale non blocca mai chi la ospita — esegue un numero
massimo di istruzioni per volta — e controlla ogni accesso: anche con istruzioni rovinate si ferma con un errore.

Prove: `pio test -e native -f test_script`. La raccolta è in `polpo/test/script/` (`.polpo` con il risultato
atteso in `.atteso`); per allungare le prove casuali: `POLPO_PROVE_CASUALI=200000 POLPO_SEME=5`.
