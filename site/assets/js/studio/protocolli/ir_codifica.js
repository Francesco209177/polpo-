// Polpo Studio — codifica dei segnali infrarossi nei tempi da trasmettere (impulso/pausa in µs), come il firmware.
// Copia JavaScript di ir_encode e ir_total_us (polpo/lib/polpo_core/src/polpo/ir/ir_codec.cpp) con la tabella dei
// protocolli di ir_signal.cpp: con l'emettitore infrarossi del telefono (PolpoNativo.irTrasmetti, android/PONTE.md)
// lo stesso tasto produce gli stessi tempi del Polpo. Le prove in site/tests/studio/vari5/ confrontano i risultati con
// il codice C++ compilato (casi generati da site/tests/studio/casi/genera_ir_codifica.py).
//
// Solo segnali di telecomandi (protocolli pubblici o RAW): una pressione di tasto alla volta, nessuna ripetizione
// automatica. Il segnale va prima controllato con `Segnale.valida()` di ir.js (come fa il firmware).

import { veroPy } from "./flipper.js";

// ---------------- protocolli (ir_signal.cpp) ----------------

/** Parametri di un protocollo nel firmware: portante, duty cycle, quante volte si invia il frame e la pausa tra i frame. */
export class ParametriIr {
  constructor(nome, bitIndirizzo, bitComando, frequenza, duty, frameMinimi, pausaFrameUs) {
    this.nome = nome;
    this.bitIndirizzo = bitIndirizzo;
    this.bitComando = bitComando;
    this.frequenza = frequenza;
    this.duty = duty;
    this.frameMinimi = frameMinimi;
    this.pausaFrameUs = pausaFrameUs;
    Object.freeze(this);
  }
}

/** I protocolli nell'ordine dell'enum IrProtocol del firmware. */
export const PARAMETRI = Object.freeze([
  new ParametriIr("NEC", 8, 8, 38000, 0.33, 1, 40000),
  new ParametriIr("NECext", 16, 16, 38000, 0.33, 1, 40000),
  new ParametriIr("NEC42", 13, 8, 38000, 0.33, 1, 40000),
  new ParametriIr("NEC42ext", 26, 16, 38000, 0.33, 1, 40000),
  new ParametriIr("Samsung32", 8, 8, 38000, 0.33, 1, 46000),
  new ParametriIr("RC5", 5, 6, 36000, 0.33, 1, 89000),
  new ParametriIr("RC5X", 5, 7, 36000, 0.33, 1, 89000),
  new ParametriIr("RC6", 8, 8, 36000, 0.33, 1, 83000),
  new ParametriIr("SIRC", 5, 7, 40000, 0.33, 3, 25000),
  new ParametriIr("SIRC15", 8, 7, 40000, 0.33, 3, 25000),
  new ParametriIr("SIRC20", 13, 7, 40000, 0.33, 3, 20000),
  new ParametriIr("Kaseikyo", 26, 10, 37000, 0.33, 1, 74000),
  new ParametriIr("RCA", 4, 8, 56000, 0.33, 1, 8000),
  new ParametriIr("Pioneer", 8, 8, 40000, 0.33, 2, 26000),
]);
/** I valori del firmware per un protocollo sconosciuto. */
export const SCONOSCIUTO = new ParametriIr("Unknown", 0, 0, 38000, 0.33, 1, 40000);

export const MAX_TEMPI_RAW = 1024;
export const MAX_TEMPO_RAW_US = 100_000;
export const MAX_TOTALE_RAW_US = 2_000_000;

// Come to_lower_ascii del firmware: solo le lettere A-Z cambiano.
const minuscoloAscii = (s) => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));

/** Indice del protocollo per nome (come ir_protocol_from_name: maiuscole e minuscole ASCII indifferenti), -1 se sconosciuto. */
export function indiceProtocollo(nome) {
  if (typeof nome !== "string") return -1;
  const n = minuscoloAscii(nome);
  return PARAMETRI.findIndex((p) => minuscoloAscii(p.nome) === n);
}

/** I parametri del protocollo con questo nome, oppure `null`. */
export function parametri(nome) {
  const i = indiceProtocollo(nome);
  return i < 0 ? null : PARAMETRI[i];
}

/** Durata totale dei tempi in µs (ir_total_us). */
export function totaleUs(tempi) {
  let t = 0;
  for (const x of tempi) t += Number(x);
  return t;
}

// ---------------- costruzione dei tempi (ir_codec.cpp) ----------------

// Una sequenza impulso/pausa che fonde i tratti consecutivi dello stesso livello e inizia sempre con un impulso.
class Costruttore {
  constructor() {
    this.d = [];
    this.ultimoImpulso = false;
  }

  impulso(us) {
    this._aggiungi(true, us);
  }

  pausa(us) {
    this._aggiungi(false, us);
  }

  _aggiungi(m, us) {
    if (us === 0) return;
    if (!this.d.length) {
      if (!m) return; // la sequenza inizia sempre con un impulso
      this.d.push(us);
      this.ultimoImpulso = true;
      return;
    }
    if (m === this.ultimoImpulso) this.d[this.d.length - 1] += us;
    else {
      this.d.push(us);
      this.ultimoImpulso = m;
    }
  }
}

// Modulazione a distanza d'impulso: intestazione, impulso di bit, pausa per lo 0 e per l'1.
const NEC = { intestazione: 9000, pausaIntestazione: 4500, bit: 560, zero: 560, uno: 1690 };
const SAMSUNG = { intestazione: 4500, pausaIntestazione: 4500, bit: 550, zero: 550, uno: 1650 };
const KASEIKYO = { intestazione: 3456, pausaIntestazione: 1728, bit: 432, zero: 432, uno: 1296 };
const RCA = { intestazione: 4000, pausaIntestazione: 4000, bit: 500, zero: 1000, uno: 2000 };
const PIONEER = { intestazione: 8500, pausaIntestazione: 4225, bit: 500, zero: 500, uno: 1500 };

// Bit inviati dal meno significativo (LSB first), poi impulso di stop. `bit` è un BigInt.
function frameDistanza(b, p, bit, n) {
  b.impulso(p.intestazione);
  b.pausa(p.pausaIntestazione);
  for (let i = 0; i < n; i++) {
    b.impulso(p.bit);
    b.pausa((bit >> BigInt(i)) & 1n ? p.uno : p.zero);
  }
  b.impulso(p.bit);
}

// Sony SIRC: modulazione a larghezza d'impulso, LSB first, nessuna pausa finale.
function frameSirc(b, bit, n) {
  b.impulso(2400);
  b.pausa(600);
  for (let i = 0; i < n; i++) {
    b.impulso((bit >>> i) & 1 ? 1200 : 600);
    if (i + 1 < n) b.pausa(600);
  }
}

// Philips RC5: Manchester, mezzo bit 889 µs, MSB first. 1 = pausa+impulso, 0 = impulso+pausa.
function frameRc5(b, indirizzo, comando, rc5x, toggle) {
  const parola = [1, rc5x ? (~comando >>> 6) & 1 : 1, toggle ? 1 : 0]; // S1, S2 (in RC5X il 7° bit del comando, invertito), T
  for (let i = 4; i >= 0; i--) parola.push((indirizzo >>> i) & 1);
  for (let i = 5; i >= 0; i--) parola.push((comando >>> i) & 1);
  const h = 889;
  for (const x of parola) {
    if (x) {
      b.pausa(h);
      b.impulso(h);
    } else {
      b.impulso(h);
      b.pausa(h);
    }
  }
}

// Philips RC6 modo 0: leader, start=1, modo 000, toggle a durata doppia, 8+8 bit MSB first. 1 = impulso+pausa.
function frameRc6(b, indirizzo, comando, toggle) {
  const t = 444;
  const bit = (uno, meta) => {
    if (uno) {
      b.impulso(meta);
      b.pausa(meta);
    } else {
      b.pausa(meta);
      b.impulso(meta);
    }
  };
  b.impulso(2666);
  b.pausa(889);
  bit(true, t);
  for (let i = 0; i < 3; i++) bit(false, t);
  bit(toggle, 2 * t);
  for (let i = 7; i >= 0; i--) bit((indirizzo >>> i) & 1, t);
  for (let i = 7; i >= 0; i--) bit((comando >>> i) & 1, t);
}

// I 48 bit di Kaseikyo: produttore, parità, genere, comando, id e controllo.
function bitKaseikyo(indirizzo, comando) {
  const id = (indirizzo >>> 24) & 3;
  const produttore = (indirizzo >>> 8) & 0xffff;
  const genere1 = (indirizzo >>> 4) & 0xf;
  const genere2 = indirizzo & 0xf;
  const d = new Array(6);
  d[0] = produttore & 0xff;
  d[1] = produttore >>> 8;
  let vp = d[0] ^ d[1];
  vp = (vp & 0xf) ^ (vp >>> 4);
  d[2] = ((vp & 0xf) | (genere1 << 4)) & 0xff;
  d[3] = ((genere2 & 0xf) | ((comando & 0xf) << 4)) & 0xff;
  d[4] = ((id << 6) | ((comando >>> 4) & 0x3f)) & 0xff;
  d[5] = d[2] ^ d[3] ^ d[4];
  let bit = 0n;
  for (let i = 0; i < 6; i++) bit |= BigInt(d[i]) << BigInt(8 * i);
  return bit;
}

const B = (x) => BigInt(x >>> 0);

// Un frame del protocollo `i` (indice di PARAMETRI); `a` e `c` sono interi senza segno a 32 bit.
function unFrame(i, a, c, b, toggle) {
  switch (PARAMETRI[i].nome) {
    case "NEC":
      return frameDistanza(b, NEC, B(a & 0xff) | (B(~a & 0xff) << 8n) | (B(c & 0xff) << 16n) | (B(~c & 0xff) << 24n), 32);
    case "NECext":
      return frameDistanza(b, NEC, B(a & 0xffff) | (B(c & 0xffff) << 16n), 32);
    case "NEC42":
      return frameDistanza(b, NEC, B(a & 0x1fff) | (B(~a & 0x1fff) << 13n) | (B(c & 0xff) << 26n) | (B(~c & 0xff) << 34n), 42);
    case "NEC42ext":
      return frameDistanza(b, NEC, B(a & 0x3ffffff) | (B(c & 0xffff) << 26n), 42);
    case "Samsung32":
      return frameDistanza(b, SAMSUNG, B(a & 0xff) | (B(a & 0xff) << 8n) | (B(c & 0xff) << 16n) | (B(~c & 0xff) << 24n), 32);
    case "Kaseikyo":
      return frameDistanza(b, KASEIKYO, bitKaseikyo(a, c), 48);
    case "RCA":
      return frameDistanza(b, RCA, B(a & 0xf) | (B(c & 0xff) << 4n) | (B(~a & 0xf) << 12n) | (B(~c & 0xff) << 16n), 24);
    case "Pioneer": // 32 bit di dati più un bit 0 aggiuntivo, come nei file .ir di riferimento
      return frameDistanza(b, PIONEER, B(a & 0xff) | (B(~a & 0xff) << 8n) | (B(c & 0xff) << 16n) | (B(~c & 0xff) << 24n), 33);
    case "SIRC":
      return frameSirc(b, (c & 0x7f) | ((a & 0x1f) << 7), 12);
    case "SIRC15":
      return frameSirc(b, (c & 0x7f) | ((a & 0xff) << 7), 15);
    case "SIRC20":
      return frameSirc(b, (c & 0x7f) | ((a & 0x1fff) << 7), 20);
    case "RC5":
      return frameRc5(b, a & 0x1f, c & 0x3f, false, toggle);
    case "RC5X":
      return frameRc5(b, a & 0x1f, c & 0x7f, true, toggle);
    case "RC6":
      return frameRc6(b, a & 0xff, c & 0xff, toggle);
  }
}

// Un intero senza segno a 32 bit (Number o BigInt), oppure null se il valore non lo è.
function u32(x) {
  if (typeof x === "bigint") x = x >= 0n && x <= 0xffffffffn ? Number(x) : NaN;
  if (typeof x === "boolean") x = Number(x);
  return Number.isInteger(x) && x >= 0 && x <= 0xffffffff ? x : null;
}

/**
 * I tempi da trasmettere per un segnale (Segnale di ir.js), ripetizioni minime del protocollo incluse, come
 * ir_encode del firmware: `{frequenza, duty, tempi}` (µs, impulso e pausa alternati, il primo è un impulso, l'ultimo
 * anche), oppure `null` se il firmware lo rifiuta. `toggle` serve a RC5/RC6 e va alternato a ogni nuova pressione.
 * Come nel firmware, indirizzo e comando oltre i bit del protocollo vengono troncati: il controllo è di `valida()`.
 * Un indirizzo, un comando o un tempo che non è un intero senza segno a 32 bit non è un segnale del firmware: `null`.
 */
export function codificaIr(segnale, toggle = false) {
  if (veroPy(segnale.raw)) {
    const t = Array.from(segnale.tempi ?? [], u32);
    if (!t.length || t.length > MAX_TEMPI_RAW) return null;
    let totale = 0;
    for (const x of t) {
      if (x === null || x === 0 || x > MAX_TEMPO_RAW_US) return null;
      totale += x;
    }
    if (totale > MAX_TOTALE_RAW_US) return null;
    return { frequenza: segnale.frequenza, duty: segnale.duty, tempi: t };
  }
  const i = indiceProtocollo(segnale.protocollo);
  const a = u32(segnale.indirizzo);
  const c = u32(segnale.comando);
  if (i < 0 || a === null || c === null) return null;
  const p = PARAMETRI[i];
  const b = new Costruttore();
  for (let f = 0; f < p.frameMinimi; f++) {
    if (f) b.pausa(p.pausaFrameUs);
    unFrame(i, a, c, b, Boolean(toggle));
  }
  // La sequenza termina sempre con un impulso: una pausa finale non serve.
  if (b.d.length && b.d.length % 2 === 0) b.d.pop();
  return b.d.length ? { frequenza: p.frequenza, duty: p.duty, tempi: b.d } : null;
}

// ---------------- l'emettitore del telefono (android/PONTE.md, irTrasmetti) ----------------

/** I limiti che l'app per Android controlla prima di trasmettere con l'emettitore del telefono. */
export const LIMITI_TELEFONO = Object.freeze({ tempiMax: 1024, totaleMaxUs: 2_000_000, frequenzaMin: 20_000, frequenzaMax: 60_000 });

/** Testo vuoto se l'app accetta questi tempi, altrimenti il motivo per cui li rifiuterebbe. */
export function controllaPerTelefono({ frequenza, tempi }) {
  if (!tempi.length) return "nessun tempo da trasmettere";
  if (tempi.length > LIMITI_TELEFONO.tempiMax) return `troppi tempi per il telefono (max ${LIMITI_TELEFONO.tempiMax})`;
  if (totaleUs(tempi) > LIMITI_TELEFONO.totaleMaxUs) return "segnale troppo lungo per il telefono (max 2 s)";
  if (!(frequenza >= LIMITI_TELEFONO.frequenzaMin && frequenza <= LIMITI_TELEFONO.frequenzaMax)) {
    return "portante fuori dalla portata dell'emettitore del telefono (20-60 kHz)";
  }
  return "";
}

/**
 * Cosa passare a `PolpoNativo.irTrasmetti(frequenza, JSON.stringify(tempi))`: `{errore}` se il segnale non è valido
 * (stesso controllo del firmware), non si codifica o supera i limiti dell'app; altrimenti `{errore: "", frequenza, tempi}`.
 */
export function preparaTrasmissioneTelefono(segnale, toggle = false) {
  const perche = segnale.valida();
  if (perche) return { errore: perche, frequenza: 0, tempi: [] };
  const t = codificaIr(segnale, toggle);
  if (t === null) return { errore: "segnale non codificabile", frequenza: 0, tempi: [] };
  const limite = controllaPerTelefono(t);
  if (limite) return { errore: limite, frequenza: 0, tempi: [] };
  return { errore: "", frequenza: t.frequenza, tempi: t.tempi };
}

/**
 * L'alternanza del bit «toggle» come nel firmware (hal/ir.cpp): parte spento e cambia dopo ogni segnale codificato,
 * così RC5 e RC6 vedono ogni invio come una nuova pressione del tasto.
 */
export class AlternanzaToggle {
  constructor() {
    this.toggle = false;
  }

  /** Come `preparaTrasmissioneTelefono` con il toggle attuale; se il segnale va bene il toggle cambia. */
  prepara(segnale) {
    const r = preparaTrasmissioneTelefono(segnale, this.toggle);
    if (!r.errore) this.toggle = !this.toggle;
    return r;
  }
}
