// Polpo Onde — ricevitore: dall'audio del microfono ai messaggi.
// Lavora a flusso: gli si passano blocchi di campioni man mano che arrivano e avvisa con eventi.
//
//  1. porta l'audio a 8 kHz tenendo solo la banda del modem (ricampiona.js);
//  2. cerca i due fischi del preambolo con un filtro adattato (correlazione);
//  3. verifica l'aggancio sui simboli noti e rifinisce il tempo;
//  4. misura l'energia dei 16 toni possibili in ogni simbolo, inseguendo l'orologio di chi trasmette;
//  5. corregge gli errori con Reed–Solomon, segnando come "cancellature" i simboli più incerti.

import * as P from "./protocollo.js";
import { chirp } from "./tx.js";
import { Ricampionatore, FS_INTERNA } from "./ricampiona.js";

const FS = FS_INTERNA;
const N_SIM = Math.round(P.T_SIMBOLO * FS); // 480 campioni per simbolo
const N_SALTO = Math.round(P.T_SALTO * FS); // 160
const N_FIN = Math.round(P.T_FINESTRA * FS); // 320
const N_CHIRP = Math.round(P.T_CHIRP * FS); // 800
const D_GIU = Math.round((P.T_CHIRP + P.T_PAUSA_CHIRP) * FS); // dall'inizio del fischio che sale a quello che scende
const D_SIMBOLI = Math.round((2 * P.T_CHIRP + P.T_PAUSA_CHIRP + P.T_SILENZIO) * FS); // dal primo fischio al primo simbolo
const N_ADD = P.ADDESTRAMENTO.length;

const PASSO = 4; // passo della ricerca grossolana (0,5 ms)
const ZONA = 240; // quando qualcosa somiglia a un fischio, si cerca il punto migliore nei 30 ms seguenti
const GIOCO_GIU = 32; // tolleranza sulla distanza tra i due fischi (±4 ms: orologi diversi, effetto Doppler)
const GIOCO_ADD = 48; // ricerca fine del tempo sui simboli noti (±6 ms)
const SONDA = 16; // sonde anticipata e ritardata dell'inseguitore del tempo (2 ms oltre i bordi)
const MARGINE = GIOCO_ADD + SONDA + 64;

// Modelli dei due fischi (in fase e in quadratura: così la ricerca non dipende dalla fase del suono).
const SU_I = chirp(FS, +1, false), SU_Q = chirp(FS, +1, true);
const GIU_I = chirp(FS, -1, false), GIU_Q = chirp(FS, -1, true);
const energiaDi = (a) => a.reduce((s, v) => s + v * v, 0);
const E_SU = energiaDi(SU_I), E_GIU = energiaDi(GIU_I);

// Seni e coseni dei 32 toni, già moltiplicati per la finestra di Hann.
const T_COS = new Float32Array(32 * N_FIN);
const T_SIN = new Float32Array(32 * N_FIN);
for (let b = 0; b < 2; b++) {
  for (let j = 0; j < 16; j++) {
    const f = P.frequenza(b, j);
    const base = (b * 16 + j) * N_FIN;
    for (let n = 0; n < N_FIN; n++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FIN);
      T_COS[base + n] = w * Math.cos((2 * Math.PI * f * n) / FS);
      T_SIN[base + n] = w * Math.sin((2 * Math.PI * f * n) / FS);
    }
  }
}

/**
 * Rumore di ogni tono, per banco: la mediana della sua energia su tutti i simboli di quel banco.
 * Un tono porta il segnale solo in un simbolo su sedici circa, quindi la mediana vede il rumore;
 * un disturbo fisso su una frequenza invece c'è sempre, finisce qui e non viene scambiato per un simbolo.
 */
function stimaRumore(E) {
  const rumore = [new Float64Array(16), new Float64Array(16)];
  for (let b = 0; b < 2; b++) {
    const campioni = Array.from({ length: 16 }, () => []);
    for (let i = b; i < E.length; i += 2) for (let j = 0; j < 16; j++) campioni[j].push(E[i][j]);
    for (let j = 0; j < 16; j++) rumore[b][j] = mediana(campioni[j]);
    const pavimento = 0.25 * mediana(Array.from(rumore[b])) + 1e-12;
    for (let j = 0; j < 16; j++) rumore[b][j] = Math.max(rumore[b][j], pavimento);
  }
  return rumore;
}

function mediana(valori) {
  if (valori.length === 0) return 0;
  const v = Float64Array.from(valori).sort();
  const m = v.length >> 1;
  return v.length & 1 ? v[m] : 0.5 * (v[m - 1] + v[m]);
}

export class Ricevitore {
  /**
   * @param {number} fs  frequenza di campionamento dell'audio in arrivo
   * @param {object} [o]
   * @param {(evento: object) => void} [o.suEvento]
   * @param {number} [o.soglia=0.2]       somiglianza minima con i due fischi per tentare l'aggancio (0…1)
   * @param {number} [o.minimoNoti=5]     simboli noti da riconoscere (su 8) per confermarlo
   */
  constructor(fs, { suEvento = () => {}, soglia = 0.2, minimoNoti = 5 } = {}) {
    this.fs = fs;
    this.suEvento = suEvento;
    this.soglia = soglia;
    this.minimoNoti = minimoNoti;
    this.ricampionatore = new Ricampionatore(fs);
    this.cap = FS * 40;
    this.x = new Float32Array(this.cap);
    this.q = new Float64Array(this.cap + 1); // somme parziali dei quadrati: energia di un tratto in un colpo solo
    this.inizio = 0; // indice assoluto (a 8 kHz) di x[0]
    this.n = 0;
    this.pos = 0; // prossimo punto da esaminare nella ricerca
    this.stato = "ascolto";
    this.trama = null;
    this.contatori = { agganci: 0, scartati: 0, messaggi: 0, falliti: 0 };
  }

  /** Secondi di audio ricevuti finora. */
  get tempo() {
    return (this.inizio + this.n) / FS;
  }

  /** Aggiunge un blocco di campioni (Float32Array alla frequenza `fs`). */
  accoda(blocco) {
    const y = this.ricampionatore.elabora(blocco);
    let i = 0;
    while (i < y.length) {
      if (this.n === this.cap) this.#compatta();
      const k = Math.min(y.length - i, this.cap - this.n);
      for (let m = 0; m < k; m++) {
        const v = y[i + m];
        this.x[this.n] = v;
        this.q[this.n + 1] = this.q[this.n] + v * v;
        this.n++;
      }
      i += k;
      this.#lavora();
    }
  }

  #compatta() {
    // Si tiene ciò che può ancora servire: la trama in corso, altrimenti gli ultimi secondi.
    const serve = this.trama ? this.trama.su - FS : this.pos - MARGINE;
    const k0 = Math.max(1, Math.min(this.n, Math.max(serve, this.inizio + this.n - 3 * FS) - this.inizio));
    this.x.copyWithin(0, k0, this.n);
    const base = this.q[k0];
    for (let i = k0; i <= this.n; i++) this.q[i - k0] = this.q[i] - base;
    this.n -= k0;
    this.inizio += k0;
    if (this.pos < this.inizio + MARGINE) this.pos = this.inizio + MARGINE;
  }

  get #fine() {
    return this.inizio + this.n;
  }

  /** Somiglianza (0…1) tra il tratto che inizia in `p` e un fischio modello. */
  #somiglianza(p, I, Q, energiaModello) {
    const i0 = p - this.inizio;
    if (i0 < 0 || i0 + N_CHIRP > this.n) return 0;
    const e = this.q[i0 + N_CHIRP] - this.q[i0];
    if (e < 1e-12) return 0;
    const x = this.x;
    let a = 0, b = 0;
    for (let k = 0; k < N_CHIRP; k++) {
      const v = x[i0 + k];
      a += v * I[k];
      b += v * Q[k];
    }
    return Math.sqrt((a * a + b * b) / (e * energiaModello));
  }

  /** Energia del tono `t` (0…31) nella finestra che inizia in `p`. */
  #energia(p, t) {
    const i0 = p - this.inizio;
    if (i0 < 0 || i0 + N_FIN > this.n) return 0;
    const x = this.x, base = t * N_FIN;
    let c = 0, s = 0;
    for (let n = 0; n < N_FIN; n++) {
      const v = x[i0 + n];
      c += v * T_COS[base + n];
      s += v * T_SIN[base + n];
    }
    return c * c + s * s;
  }

  #lavora() {
    for (;;) {
      if (this.stato === "ascolto") {
        if (!this.#cerca()) return;
      } else if (this.stato === "aggancio") {
        const t = this.trama;
        if (this.#fine < t.s0 + N_ADD * N_SIM + MARGINE) return;
        this.#verificaAggancio();
      } else if (this.stato === "intestazione") {
        const t = this.trama;
        if (this.#fine < t.s0 + P.SIMBOLI_FISSI * N_SIM + MARGINE) return;
        this.#leggiIntestazione();
      } else if (this.stato === "dati") {
        const t = this.trama;
        if (this.#fine < t.s0 + t.simboli * N_SIM + MARGINE) return;
        this.#leggiDati();
      }
    }
  }

  /** Ricerca del preambolo. Restituisce false quando servono altri campioni. */
  #cerca() {
    if (this.pos < this.inizio + MARGINE) this.pos = this.inizio + MARGINE;
    const serve = ZONA + D_GIU + GIOCO_GIU + N_CHIRP + 8;
    while (this.pos + serve <= this.#fine) {
      const cu = this.#somiglianza(this.pos, SU_I, SU_Q, E_SU);
      if (cu < 0.75 * this.soglia) {
        this.pos += PASSO;
        continue;
      }
      // Qualcosa somiglia al fischio che sale: punto migliore nella zona, poi si cerca quello che scende.
      let pu = this.pos, mu = cu;
      for (let p = this.pos + 2; p <= this.pos + ZONA; p += 2) {
        const c = this.#somiglianza(p, SU_I, SU_Q, E_SU);
        if (c > mu) { mu = c; pu = p; }
      }
      let pd = pu + D_GIU, md = 0;
      for (let d = -GIOCO_GIU; d <= GIOCO_GIU; d += 2) {
        const c = this.#somiglianza(pu + D_GIU + d, GIU_I, GIU_Q, E_GIU);
        if (c > md) { md = c; pd = pu + D_GIU + d; }
      }
      const qualita = Math.sqrt(mu * md);
      if (qualita < this.soglia || Math.min(mu, md) < 0.6 * this.soglia) {
        this.pos += ZONA >> 1;
        continue;
      }
      // rifinitura al campione
      for (const [I, Q, E, quale] of [[SU_I, SU_Q, E_SU, 0], [GIU_I, GIU_Q, E_GIU, 1]]) {
        let centro = quale ? pd : pu, meglio = centro, m = 0;
        for (let p = centro - 2; p <= centro + 2; p++) {
          const c = this.#somiglianza(p, I, Q, E);
          if (c > m) { m = c; meglio = p; }
        }
        if (quale) pd = meglio; else pu = meglio;
      }
      // Il punto di mezzo tra i due fischi non risente di uno scarto di frequenza (li sposta in versi opposti).
      const su = (pu + pd - D_GIU) / 2;
      this.trama = { su: Math.round(su), s0: su + D_SIMBOLI, qualita, scartoFischi: pd - pu - D_GIU };
      this.stato = "aggancio";
      return true;
    }
    return false;
  }

  /** Energie dei 16 toni del banco del simbolo `i`, con l'inizio del simbolo in `s` (campioni, anche frazionari). */
  #energieSimbolo(i, s) {
    const b = P.banco(i);
    const p = Math.round(s) + N_SALTO;
    const E = new Float64Array(16);
    for (let j = 0; j < 16; j++) E[j] = this.#energia(p, b * 16 + j);
    return E;
  }

  #verificaAggancio() {
    const t = this.trama;
    let meglio = null;
    for (let d = -GIOCO_ADD; d <= GIOCO_ADD; d += 8) {
      const E = [];
      for (let i = 0; i < N_ADD; i++) E.push(this.#energieSimbolo(i, t.s0 + d + i * N_SIM));
      const rumore = stimaRumore(E);
      let giusti = 0, forza = 0;
      for (let i = 0; i < N_ADD; i++) {
        const N = rumore[P.banco(i)];
        const atteso = P.tonoDi(i, P.ADDESTRAMENTO[i]);
        let somma = 0, max = 0, jmax = 0;
        for (let j = 0; j < 16; j++) {
          const m = E[i][j] / N[j];
          somma += m;
          if (m > max) { max = m; jmax = j; }
        }
        if (jmax === atteso) giusti++;
        if (somma > 0) forza += E[i][atteso] / N[atteso] / somma;
      }
      const voto = giusti + forza / N_ADD;
      if (!meglio || voto > meglio.voto) meglio = { voto, giusti, d };
    }
    if (meglio.giusti < this.minimoNoti) {
      this.contatori.scartati++;
      this.suEvento({ tipo: "scartato", tempo: t.su / FS, qualita: t.qualita, noti: meglio.giusti });
      this.#riprendi(t.su + (N_CHIRP >> 1));
      return;
    }
    t.s0 += meglio.d;
    t.noti = meglio.giusti;
    t.energie = [];
    t.inseguitore = { s: t.s0, deriva: 0 };
    this.contatori.agganci++;
    this.stato = "intestazione";
    this.suEvento({ tipo: "aggancio", tempo: t.su / FS, qualita: t.qualita, noti: t.noti });
  }

  /** Misura i simboli da `da` (compreso) ad `a` (escluso) inseguendo il tempo; riempie trama.energie. */
  #misura(da, a) {
    const t = this.trama, ins = t.inseguitore;
    const picco = (E) => E.reduce((m, v) => Math.max(m, v), 0);
    for (let i = da; i < a; i++) {
      let E = this.#energieSimbolo(i, ins.s);
      let max = 0, secondo = 0, jmax = 0;
      const guarda = () => {
        max = 0; secondo = 0; jmax = 0;
        for (let j = 0; j < 16; j++) {
          if (E[j] > max) { secondo = max; max = E[j]; jmax = j; } else if (E[j] > secondo) secondo = E[j];
        }
      };
      guarda();
      ins.incerti = max > 3 * secondo ? 0 : (ins.incerti || 0) + 1;
      if (ins.incerti >= 3 && i + 2 < a) {
        // Tre simboli di fila illeggibili: forse il dispositivo ha perso dei campioni e il tempo è saltato.
        // Si cerca, entro mezzo simbolo, lo spostamento che rende più netti questo simbolo e i due seguenti.
        const forza = (d) => picco(this.#energieSimbolo(i, ins.s + d)) + picco(this.#energieSimbolo(i + 1, ins.s + d + N_SIM)) + picco(this.#energieSimbolo(i + 2, ins.s + d + 2 * N_SIM));
        const ora = forza(0);
        let meglio = 0, valore = ora;
        for (let d = -(N_SIM >> 1); d <= N_SIM >> 1; d += 16) {
          const f = forza(d);
          if (f > valore) { valore = f; meglio = d; }
        }
        if (Math.abs(meglio) >= 32 && valore > 3 * ora) {
          ins.s += meglio;
          t.riagganci = (t.riagganci || 0) + 1;
          E = this.#energieSimbolo(i, ins.s);
          guarda();
        }
        ins.incerti = 0;
      }
      t.energie.push(E);
      let correzione = 0;
      if (max > 3 * secondo) {
        // Inseguitore anticipo/ritardo: confronta l'energia del tono appena prima e appena dopo i bordi del simbolo.
        const tono = P.banco(i) * 16 + jmax;
        const s = Math.round(ins.s);
        const prima = this.#energia(s - SONDA, tono);
        const dopo = this.#energia(s + N_SALTO + SONDA, tono);
        if (prima + dopo > 0) correzione = Math.max(-24, Math.min(24, (152 * (dopo - prima)) / (dopo + prima)));
      }
      ins.deriva += 0.004 * correzione;
      ins.deriva = Math.max(-4, Math.min(4, ins.deriva));
      ins.s += N_SIM + ins.deriva + 0.12 * correzione;
    }
  }

  /**
   * Decide i simboli da `da` ad `a` usando tutte le energie misurate per stimare il rumore di ogni tono.
   * @returns {{toni: Uint8Array, nibble: Uint8Array, sicurezza: Float64Array}}
   */
  #decidi(da, a) {
    const E = this.trama.energie;
    const rumore = stimaRumore(E);
    const scegli = (i, Ei) => {
      const N = rumore[P.banco(i)];
      let max = 0, secondo = 0, jmax = 0;
      for (let j = 0; j < 16; j++) {
        const m = Ei[j] / N[j];
        if (m > max) { secondo = max; max = m; jmax = j; } else if (m > secondo) secondo = m;
      }
      return { jmax, sicurezza: max / (secondo + 1e-12) };
    };
    // Prima passata: decisione semplice su tutti i simboli misurati.
    const primo = E.map((Ei, i) => scegli(i, Ei).jmax);
    // In una stanza che rimbomba la nota di due simboli prima (stesso banco) è ancora nell'aria.
    // Si stima quanta ne resta (rapporto mediano) e la si toglie prima di decidere di nuovo.
    const resto = [2, 4].map((passo) => {
      const rapporti = [];
      for (let i = passo; i < E.length; i++) {
        const j = primo[i - passo];
        if (j === primo[i]) continue;
        rapporti.push(Math.max(0, E[i][j] - rumore[P.banco(i)][j]) / (E[i - passo][j] + 1e-30));
      }
      return rapporti.length >= 6 ? Math.min(0.9, mediana(rapporti)) : 0;
    });
    const n = a - da;
    const toni = new Uint8Array(n), nibble = new Uint8Array(n), sicurezza = new Float64Array(n);
    const Ei = new Float64Array(16);
    for (let i = da; i < a; i++) {
      Ei.set(E[i]);
      [2, 4].forEach((passo, k) => {
        if (i >= passo && resto[k] > 0.02) {
          const j = primo[i - passo];
          Ei[j] = Math.max(0, Ei[j] - resto[k] * E[i - passo][j]);
        }
      });
      const s = scegli(i, Ei);
      toni[i - da] = s.jmax;
      nibble[i - da] = P.nibbleDi(i, s.jmax);
      sicurezza[i - da] = s.sicurezza;
    }
    return { toni, nibble, sicurezza, resto };
  }

  /** Prova a correggere con un numero crescente di cancellature, scelte tra i byte più incerti. */
  #correggi(nibble, sicurezza, nsym, leggi) {
    const bytes = P.nibbleInByte(nibble);
    const ordine = Array.from(bytes.keys()).sort((p, q) => Math.min(sicurezza[2 * p], sicurezza[2 * p + 1]) - Math.min(sicurezza[2 * q], sicurezza[2 * q + 1]));
    const tentativi = [...new Set([0, nsym >> 2, nsym >> 1, (3 * nsym) >> 2, nsym - 2].filter((c) => c >= 0 && c <= nsym))];
    for (const c of tentativi) {
      const r = leggi(bytes, ordine.slice(0, c));
      if (r) return r;
    }
    return null;
  }

  #leggiIntestazione() {
    const t = this.trama;
    this.#misura(0, P.SIMBOLI_FISSI);
    const d = this.#decidi(N_ADD, P.SIMBOLI_FISSI);
    const h = this.#correggi(d.nibble, d.sicurezza, P.PARITA_INTESTAZIONE, (b, c) => P.leggiIntestazione(b, c));
    if (!h) {
      this.contatori.falliti++;
      this.suEvento({ tipo: "fallito", fase: "intestazione", tempo: t.su / FS, qualita: t.qualita });
      this.#riprendi(t.su + D_SIMBOLI);
      return;
    }
    t.intestazione = h;
    t.simboli = P.simboliTrama(h.lunghezza);
    this.stato = "dati";
    this.suEvento({ tipo: "intestazione", tempo: t.su / FS, lunghezza: h.lunghezza, durata: P.durata(h.lunghezza), simboli: t.simboli });
  }

  #leggiDati() {
    const t = this.trama, h = t.intestazione;
    this.#misura(P.SIMBOLI_FISSI, t.simboli);
    const d = this.#decidi(P.SIMBOLI_FISSI, t.simboli);
    const nsym = P.parita(h.lunghezza + 2);
    const r = this.#correggi(d.nibble, d.sicurezza, nsym, (b, c) => P.leggiDati(b, h, c));
    const fine = Math.round(t.inseguitore.s);
    const sicurezzaMediana = mediana(Array.from(d.sicurezza));
    if (!r) {
      this.contatori.falliti++;
      this.suEvento({ tipo: "fallito", fase: "dati", tempo: t.su / FS, qualita: t.qualita, lunghezza: h.lunghezza, sicurezza: sicurezzaMediana });
    } else {
      this.contatori.messaggi++;
      this.suEvento({
        tipo: "messaggio",
        testo: r.testo,
        carico: r.carico,
        tempo: t.su / FS,
        qualita: t.qualita,
        byteCorretti: r.errori + r.cancellature,
        byteParita: nsym,
        sicurezza: sicurezzaMediana,
        deriva: t.inseguitore.deriva / N_SIM,
        primoSimbolo: t.s0 / FS,
        toni: this.#decidi(0, t.simboli).toni,
      });
    }
    this.#riprendi(fine);
  }

  #riprendi(da) {
    this.trama = null;
    this.stato = "ascolto";
    this.pos = Math.max(this.pos, Math.round(da));
  }
}

/** Comodità per prove e canale simulato: decodifica un'intera registrazione. */
export function ricevi(segnale, fs, opzioni = {}) {
  const eventi = [];
  const rx = new Ricevitore(fs, { ...opzioni, suEvento: (e) => eventi.push(e) });
  const blocco = opzioni.blocco || 4096;
  for (let i = 0; i < segnale.length; i += blocco) rx.accoda(segnale.subarray(i, Math.min(segnale.length, i + blocco)));
  rx.accoda(new Float32Array(Math.ceil(fs * 0.3))); // un po' di silenzio per chiudere l'ultima trama
  return { eventi, messaggi: eventi.filter((e) => e.tipo === "messaggio"), ricevitore: rx };
}
