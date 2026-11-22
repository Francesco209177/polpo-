// Polpo Onde — il protocollo: costanti, struttura della trama, conversione testo ⇄ simboli.
// La specifica completa, con i vettori di prova, è in site/docs/PROTOCOLLO_ONDE.md.
// Tutto è espresso in hertz e secondi: non dipende dalla frequenza di campionamento del dispositivo.

import { crc8, crc16 } from "./crc.js";
import { codifica, decodifica } from "./rs.js";

export const VERSIONE = 1;
export const PROFILO_ROBUSTO = 0;

// Toni: 32 frequenze a passi di 50 Hz. Banco A = toni pari, banco B = toni dispari (100 Hz tra toni dello stesso banco).
export const F_BASE = 1600;
export const F_PASSO = 50;
export const TONI_PER_BANCO = 16;
export const F_MIN = F_BASE;
export const F_MAX = F_BASE + F_PASSO * (2 * TONI_PER_BANCO - 1); // 3150 Hz

// Tempi di un simbolo (una nota = 4 bit).
export const T_SIMBOLO = 0.06;
export const T_RAMPA = 0.004; // salita e discesa a coseno rialzato
export const T_SALTO = 0.02; // il ricevitore ignora l'inizio (eco del simbolo precedente)
export const T_FINESTRA = 0.04; // e misura l'energia sul resto

// Preambolo.
export const T_AVVIO = 0.25; // tono leggero che "sveglia" altoparlante e microfono
export const F_AVVIO = 1000;
export const A_AVVIO = 0.25;
export const T_CHIRP = 0.1; // fischio che sale, poi fischio che scende
export const T_PAUSA_CHIRP = 0.02;
export const T_SILENZIO = 0.06;
export const T_CODA = 0.03;
export const T_PREAMBOLO = T_AVVIO + T_CHIRP + T_PAUSA_CHIRP + T_CHIRP + T_SILENZIO;

/** Simboli noti che seguono il preambolo: servono a verificare l'aggancio e a rifinire il tempo. */
export const ADDESTRAMENTO = Object.freeze([0, 15, 5, 10, 3, 12, 6, 9]);
export const BYTE_INTESTAZIONE = 7; // 3 byte utili + 4 di parità
export const PARITA_INTESTAZIONE = 4;
export const SIMBOLI_FISSI = ADDESTRAMENTO.length + 2 * BYTE_INTESTAZIONE; // 22
export const MAX_BYTE = 120;

/** Salto di frequenza del simbolo numero `i` (contato dal primo simbolo di addestramento). */
export function salto(i) {
  const m = i >> 1;
  return i & 1 ? (11 * m + 5) & 15 : (7 * m) & 15;
}
export function banco(i) {
  return i & 1;
}
/** Tono (0…15 nel suo banco) con cui si trasmette il valore `nibble` nel simbolo `i`. */
export function tonoDi(i, nibble) {
  return (nibble + salto(i)) & 15;
}
/** Valore trasmesso, dato il tono ricevuto nel simbolo `i`. */
export function nibbleDi(i, tono) {
  return (tono - salto(i)) & 15;
}
/** Frequenza in hertz del tono `j` del banco `b`. */
export function frequenza(b, j) {
  return F_BASE + F_PASSO * (2 * j + b);
}

/** Byte di parità per `k` byte di dati (testo + CRC-16): codice a metà, tra 8 e 64. */
export function parita(k) {
  return Math.min(64, Math.max(8, k + (k & 1)));
}
/** Byte trasmessi nella parte dati per un testo di `lunghezza` byte. */
export function byteDati(lunghezza) {
  const k = lunghezza + 2;
  return k + parita(k);
}
/** Numero totale di simboli di una trama. */
export function simboliTrama(lunghezza) {
  return SIMBOLI_FISSI + 2 * byteDati(lunghezza);
}
/** Durata in secondi di una trama completa. */
export function durata(lunghezza) {
  return T_PREAMBOLO + simboliTrama(lunghezza) * T_SIMBOLO + T_CODA;
}

export function byteInNibble(bytes) {
  const out = new Uint8Array(bytes.length * 2);
  for (let i = 0; i < bytes.length; i++) {
    out[2 * i] = bytes[i] >> 4;
    out[2 * i + 1] = bytes[i] & 15;
  }
  return out;
}
export function nibbleInByte(nibble) {
  const out = new Uint8Array(nibble.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = (nibble[2 * i] << 4) | nibble[2 * i + 1];
  return out;
}

export class ErroreMessaggio extends Error {}

/** Converte un testo nei byte UTF-8 da trasmettere, controllando i limiti. */
export function byteDelTesto(testo) {
  const bytes = new TextEncoder().encode(testo);
  if (bytes.length === 0) throw new ErroreMessaggio("Il messaggio è vuoto.");
  if (bytes.length > MAX_BYTE) throw new ErroreMessaggio(`Il messaggio è troppo lungo: ${bytes.length} byte, il massimo è ${MAX_BYTE}.`);
  return bytes;
}

/**
 * Costruisce la trama di un messaggio.
 * @returns {{carico: Uint8Array, intestazione: Uint8Array, dati: Uint8Array, nibble: Uint8Array, toni: {banco:number, tono:number, frequenza:number}[]}}
 */
export function componi(testo, profilo = PROFILO_ROBUSTO) {
  const carico = typeof testo === "string" ? byteDelTesto(testo) : testo;
  if (carico.length < 1 || carico.length > MAX_BYTE) throw new ErroreMessaggio("Lunghezza del messaggio non valida.");
  const b0 = (VERSIONE << 4) | (profilo & 15);
  const b1 = carico.length;
  const intestazione = codifica(Uint8Array.of(b0, b1, crc8([b0, b1])), PARITA_INTESTAZIONE);

  const k = carico.length + 2;
  const blocco = new Uint8Array(k);
  blocco.set(carico);
  const crc = crc16([b0, b1, ...carico]); // l'intestazione entra nel controllo: lega le due parti
  blocco[k - 2] = crc >> 8;
  blocco[k - 1] = crc & 0xff;
  const dati = codifica(blocco, parita(k));

  const nibble = new Uint8Array(simboliTrama(carico.length));
  nibble.set(ADDESTRAMENTO);
  nibble.set(byteInNibble(intestazione), ADDESTRAMENTO.length);
  nibble.set(byteInNibble(dati), SIMBOLI_FISSI);
  const toni = Array.from(nibble, (v, i) => {
    const t = tonoDi(i, v);
    return { banco: banco(i), tono: t, frequenza: frequenza(banco(i), t) };
  });
  return { carico, intestazione, dati, nibble, toni };
}

/**
 * Legge i 7 byte dell'intestazione ricevuta.
 * @returns {{versione:number, profilo:number, lunghezza:number, correzioni:number} | null}
 */
export function leggiIntestazione(bytes, cancellature = []) {
  const r = decodifica(bytes, PARITA_INTESTAZIONE, cancellature);
  if (!r) return null;
  const [b0, b1, c] = r.parola;
  if (crc8([b0, b1]) !== c) return null;
  const versione = b0 >> 4;
  const lunghezza = b1;
  if (versione !== VERSIONE || lunghezza < 1 || lunghezza > MAX_BYTE) return null;
  return { versione, profilo: b0 & 15, lunghezza, correzioni: r.errori + r.cancellature };
}

/**
 * Legge la parte dati ricevuta.
 * @param {Uint8Array} bytes  byteDati(lunghezza) byte come ricevuti
 * @param {{profilo:number, lunghezza:number}} intestazione
 * @returns {{carico: Uint8Array, testo: string, errori:number, cancellature:number} | null}
 */
export function leggiDati(bytes, intestazione, cancellature = []) {
  const k = intestazione.lunghezza + 2;
  if (bytes.length !== byteDati(intestazione.lunghezza)) return null;
  const r = decodifica(bytes, parita(k), cancellature);
  if (!r) return null;
  const carico = r.parola.subarray(0, intestazione.lunghezza);
  const b0 = (VERSIONE << 4) | (intestazione.profilo & 15);
  const crc = crc16([b0, intestazione.lunghezza, ...carico]);
  if (r.parola[k - 2] !== crc >> 8 || r.parola[k - 1] !== (crc & 0xff)) return null;
  return { carico: Uint8Array.from(carico), testo: new TextDecoder().decode(carico), errori: r.errori, cancellature: r.cancellature };
}
