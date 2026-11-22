// Polpo Onde — modello di canale acustico SIMULATO: altoparlante, stanza, microfono.
// Serve alle prove automatiche e alla modalità «canale simulato» della pagina. Non sostituisce la prova dal vero:
// un altoparlante e una stanza reali fanno cose che nessun modello descrive del tutto.

import { convoluzione, fft, potenzaDiDue } from "./fft.js";
import { F_MIN, F_MAX } from "./protocollo.js";

/** Numeri casuali ripetibili: stesso seme, stessa sequenza. */
export function casuale(seme) {
  let a = seme >>> 0;
  const f = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.intero = (n) => Math.floor(f() * n);
  f.tra = (min, max) => min + (max - min) * f();
  f.gauss = () => {
    let u = 0;
    while (u === 0) u = f();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * f());
  };
  return f;
}

/** Filtro del secondo ordine (formule RBJ). tipo: "alto" = passa-alto, "basso" = passa-basso. */
export function filtra(x, fs, tipo, frequenza, q = Math.SQRT1_2) {
  const w = (2 * Math.PI * frequenza) / fs;
  const alfa = Math.sin(w) / (2 * q), c = Math.cos(w);
  let b0, b1, b2;
  if (tipo === "alto") { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
  else { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
  const a0 = 1 + alfa, a1 = -2 * c, a2 = 1 - alfa;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

/** Risposta all'impulso di una stanza: suono diretto, prime riflessioni, coda di riverbero. */
export function stanza(fs, { riflessioni = [], rt60 = 0, drr = 6 } = {}, rnd = casuale(1)) {
  const durata = Math.max(rt60 * 1.2, ...riflessioni.map((r) => r.ritardo), 0) + 0.002;
  const h = new Float32Array(Math.ceil(durata * fs) + 1);
  h[0] = 1;
  for (const { ritardo, guadagno } of riflessioni) h[Math.round(ritardo * fs)] += guadagno;
  if (rt60 > 0) {
    const da = Math.round(0.005 * fs);
    const coda = new Float32Array(h.length);
    let energia = 0;
    for (let i = da; i < h.length; i++) {
      coda[i] = rnd.gauss() * Math.pow(10, (-3 * (i - da)) / (rt60 * fs)); // −60 dB dopo rt60 secondi
      energia += coda[i] * coda[i];
    }
    const k = Math.sqrt(Math.pow(10, -drr / 10) / energia); // drr = rapporto diretto/riverbero in dB
    for (let i = da; i < h.length; i++) h[i] += k * coda[i];
  }
  return h;
}

const ZERI = 16, FASI = 256;
let nucleo = null;
function tabellaSinc() {
  if (nucleo) return nucleo;
  nucleo = new Float32Array((FASI + 1) * 2 * ZERI);
  for (let q = 0; q <= FASI; q++) {
    for (let m = 0; m < 2 * ZERI; m++) {
      const u = m - ZERI + 1 - q / FASI; // distanza dal punto da ricostruire, in campioni
      const s = u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u);
      const w = Math.abs(u) >= ZERI ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * u) / ZERI);
      nucleo[q * 2 * ZERI + m] = s * w;
    }
  }
  return nucleo;
}

/**
 * Cambia la frequenza di campionamento con un rapporto qualsiasi, anche lentamente variabile.
 * @param {(n:number)=>number} passo  campioni d'ingresso da avanzare per ogni campione d'uscita (≈ fsIn/fsOut)
 */
export function ricampionaLibero(x, passo, lunghezzaUscita) {
  const tab = tabellaSinc();
  const y = new Float32Array(lunghezzaUscita);
  let p = 0;
  for (let n = 0; n < lunghezzaUscita; n++) {
    const c = Math.floor(p);
    const q = Math.round((p - c) * FASI);
    const base = q * 2 * ZERI;
    let acc = 0;
    for (let m = 0; m < 2 * ZERI; m++) {
      const i = c - ZERI + 1 + m;
      if (i >= 0 && i < x.length) acc += x[i] * tab[base + m];
    }
    y[n] = acc;
    p += passo(n);
  }
  return y;
}

function potenzaInBanda(x, fs) {
  const n = potenzaDiDue(Math.min(x.length, 1 << 16)) >> (x.length < 1 << 16 ? 1 : 0) || 2;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = x[i] || 0;
  fft(re, im);
  let s = 0;
  const k0 = Math.ceil((F_MIN * n) / fs), k1 = Math.floor((F_MAX * n) / fs);
  for (let k = k0; k <= k1; k++) s += re[k] * re[k] + im[k] * im[k];
  return (2 * s) / (n * n);
}

function rumoreRosa(n, rnd) {
  // filtro di Paul Kellet: densità che cala di 3 dB per ottava
  const y = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = rnd.gauss();
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    y[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  return y;
}

/**
 * Fa passare un segnale trasmesso attraverso il canale simulato.
 * @param {Float32Array} segnale  audio trasmesso
 * @param {number} fs             sua frequenza di campionamento
 * @param {object} o              tutte le voci sono facoltative
 * @param {number} [o.anticipo=0.3]   secondi di attesa prima del segnale
 * @param {number} [o.coda=0.3]       secondi dopo
 * @param {number} [o.saturazione]    distorsione dolce dell'altoparlante (0 = nessuna, 3 = forte)
 * @param {number} [o.passaAlto]      l'altoparlante non riproduce sotto questa frequenza (Hz)
 * @param {number} [o.passaBasso]     né sopra questa
 * @param {{ritardo:number, guadagno:number}[]} [o.riflessioni]
 * @param {number} [o.rt60]           tempo di riverbero della stanza (s)
 * @param {number} [o.drr=6]          rapporto tra suono diretto e riverbero (dB)
 * @param {number} [o.fsUscita=fs]    frequenza di campionamento di chi riceve
 * @param {number} [o.ppm=0]          errore dell'orologio di chi riceve (parti per milione)
 * @param {{ppm:number, hz:number}} [o.dondolio]  variazione lenta della velocità (telefono tenuto in mano)
 * @param {number} [o.snr]            rapporto segnale/rumore nella banda del modem (dB); senza, niente rumore
 * @param {"bianco"|"rosa"} [o.rumore="bianco"]
 * @param {{f:number, db:number}[]} [o.disturbi]  toni fissi, livello in dB rispetto al segnale
 * @param {{alSecondo:number, db:number}} [o.scatti]  scatti improvvisi
 * @param {{obiettivo:number, rilascio:number, massimo:number}} [o.agc]  controllo automatico del guadagno del microfono
 * @param {number} [o.guadagno=1]
 * @param {number} [o.taglio]         il microfono satura a questo livello (taglio netto)
 * @param {{t:number, durata:number}[]} [o.buchi]  campioni persi (tempi in secondi, riferiti all'uscita)
 * @param {Function} [rnd]            generatore casuale (vedi `casuale`)
 * @returns {Float32Array} audio ricevuto, alla frequenza o.fsUscita
 */
export function canale(segnale, fs, o = {}, rnd = casuale(1)) {
  const anticipo = o.anticipo ?? 0.3, coda = o.coda ?? 0.3;
  let x = Float32Array.from(segnale);

  if (o.saturazione) {
    const g = o.saturazione, k = 1 / Math.tanh(g);
    for (let i = 0; i < x.length; i++) x[i] = Math.tanh(g * x[i]) * k;
  }
  if (o.passaAlto) x = filtra(filtra(x, fs, "alto", o.passaAlto), fs, "alto", o.passaAlto);
  if (o.passaBasso) x = filtra(filtra(x, fs, "basso", o.passaBasso), fs, "basso", o.passaBasso);
  if (o.rt60 || (o.riflessioni && o.riflessioni.length)) x = convoluzione(x, stanza(fs, o, rnd));

  // silenzio prima e dopo, poi il passaggio all'orologio di chi riceve
  const fsOut = o.fsUscita ?? fs;
  const largo = new Float32Array(Math.round(anticipo * fs) + x.length + Math.round(coda * fs));
  largo.set(x, Math.round(anticipo * fs));
  const base = (fs / fsOut) / (1 + (o.ppm ?? 0) * 1e-6);
  let y;
  if (base === 1 && !o.dondolio) y = largo;
  else {
    const d = o.dondolio;
    const passo = d ? (n) => base * (1 + d.ppm * 1e-6 * Math.sin((2 * Math.PI * d.hz * n) / fsOut)) : () => base;
    y = ricampionaLibero(largo, passo, Math.floor(largo.length / base));
  }

  // livello del segnale nel tratto in cui c'è la trama: riferimento per rumore e disturbi
  const i0 = Math.round(anticipo * fsOut), i1 = Math.min(y.length, i0 + Math.round((segnale.length / fs) * fsOut));
  let ps = 0;
  for (let i = i0; i < i1; i++) ps += y[i] * y[i];
  ps /= Math.max(1, i1 - i0);
  const ampiezza = Math.sqrt(2 * ps); // di un tono con la stessa potenza

  if (o.snr !== undefined) {
    const pn = ps / Math.pow(10, o.snr / 10); // potenza di rumore voluta dentro la banda F_MIN…F_MAX
    if (o.rumore === "rosa") {
      const r = rumoreRosa(y.length, rnd);
      const k = Math.sqrt(pn / potenzaInBanda(r, fsOut));
      for (let i = 0; i < y.length; i++) y[i] += k * r[i];
    } else {
      const sigma = Math.sqrt((pn * (fsOut / 2)) / (F_MAX - F_MIN));
      for (let i = 0; i < y.length; i++) y[i] += sigma * rnd.gauss();
    }
  }
  for (const { f, db } of o.disturbi ?? []) {
    const a = ampiezza * Math.pow(10, db / 20), fase = rnd() * 2 * Math.PI;
    for (let i = 0; i < y.length; i++) y[i] += a * Math.sin((2 * Math.PI * f * i) / fsOut + fase);
  }
  if (o.scatti) {
    const a = ampiezza * Math.pow(10, o.scatti.db / 20);
    const quanti = Math.round((o.scatti.alSecondo * y.length) / fsOut);
    for (let k = 0; k < quanti; k++) {
      const p = rnd.intero(y.length), lung = 2 + rnd.intero(Math.round(0.002 * fsOut));
      const segno = rnd() < 0.5 ? -1 : 1;
      for (let i = p; i < Math.min(y.length, p + lung); i++) y[i] += segno * a * Math.exp((-3 * (i - p)) / lung);
    }
  }
  if (o.agc) {
    const { obiettivo = 0.3, rilascio = 0.4, massimo = 30 } = o.agc;
    const cala = Math.exp(-1 / (rilascio * fsOut)), sale = Math.exp(-1 / (0.003 * fsOut));
    let inv = obiettivo / massimo;
    for (let i = 0; i < y.length; i++) {
      const v = Math.abs(y[i]);
      inv = v > inv ? sale * inv + (1 - sale) * v : Math.max(obiettivo / massimo, cala * inv);
      y[i] *= Math.min(massimo, obiettivo / inv);
    }
  }
  const g = o.guadagno ?? 1;
  if (g !== 1) for (let i = 0; i < y.length; i++) y[i] *= g;
  if (o.taglio) for (let i = 0; i < y.length; i++) y[i] = Math.max(-o.taglio, Math.min(o.taglio, y[i]));
  if (o.buchi && o.buchi.length) {
    const tieni = new Uint8Array(y.length).fill(1);
    for (const { t, durata } of o.buchi) tieni.fill(0, Math.round(t * fsOut), Math.min(y.length, Math.round((t + durata) * fsOut)));
    y = y.filter((_, i) => tieni[i]);
  }
  return y;
}
