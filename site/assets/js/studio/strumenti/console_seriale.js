// Polpo Studio — console seriale per schede Arduino/ESP32 (non per il Polpo, che usa Polpo Link).
// Copia JavaScript delle parti pure di studio/polpo_studio/devices/serial_console.py (velocità ammesse, 1200 baud
// rifiutato, fine riga, vista esadecimale) e della scheda «Console seriale» di app/tools/gpio_tools.py (testi, cosa
// si mostra di ciò che arriva, cosa si invia, il registro da salvare). Nel telefono la porta la apre l'app per Android
// (PolpoNativo.serialeApri, android/PONTE.md), che rifiuta anch'essa 1200 baud.
//
// La finestra della console di Polpo Studio tiene al massimo 5000 righe: `Terminale` fa lo stesso con le stesse regole
// (ogni pezzo ricevuto è a sé: "\r\n" vale un solo a capo se arriva tutto insieme).

import { ErrorePy } from "../protocolli/flipper.js";
import { codificaUtf8, decodificaUtf8, errorePy, formattaData, reprPy } from "./convertitore.js";

/** Le velocità del menu, in baud (1200 non c'è: fa ripartire molte schede nel bootloader). */
export const VELOCITA = Object.freeze([300, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 230400, 460800, 921600]);
export const VELOCITA_PREDEFINITA = 115200;
export const BAUD_BOOTLOADER = 1200;

/** I fine riga che si possono aggiungere a ciò che si invia, nell'ordine del menu. */
export const FINE_RIGA = Object.freeze({ "": "", LF: "\n", CR: "\r", CRLF: "\r\n" });
export const FINE_RIGA_PREDEFINITA = "LF";

/** Le righe tenute dalla finestra della console. */
export const RIGHE_MAX = 5000;

/** ConsoleError di serial_console.py. */
export class ErroreConsole extends ErrorePy {
  static tipo = "ConsoleError";
}

export const MESSAGGIO_1200 = "1200 baud fa ripartire molte schede (ESP32-S3, Leonardo) nel bootloader: scegli un'altra velocità";

/** Le voci del menu dei fine riga: [nome, chiave] ("nessuno" per nessun fine riga). */
export function vociFineRiga() {
  return Object.keys(FINE_RIGA).map((k) => [k || "nessuno", k]);
}

/** Lancia ErroreConsole se la velocità è quella del bootloader (1200 baud), come SerialConsole. */
export function controllaVelocita(baud) {
  if (baud === BAUD_BOOTLOADER) throw new ErroreConsole(MESSAGGIO_1200);
}

/**
 * Le opzioni per PolpoNativo.serialeApri: con «Riavvia la scheda all'apertura» le linee restano come le lascia pyserial
 * aprendo la porta (DTR e RTS attive); senza, DTR e RTS restano basse, perché alcune schede si riavviano quando il PC
 * alza DTR. Lancia ErroreConsole per 1200 baud.
 */
export function opzioniApertura(baud, riavvia = true) {
  controllaVelocita(baud);
  return riavvia ? { baud, dtr: true, rts: true } : { baud, dtr: false, rts: false };
}

/** I byte in esadecimale maiuscolo separati da spazi ("48 65 6C"), come hexdump. */
export function esadecimale(dati) {
  return Array.from(dati, (b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
}

/** Il testo da aggiungere alla console per un pezzo ricevuto: esadecimale (con uno spazio dopo) o UTF-8 (errori → �). */
export function testoRicevuto(dati, esa = false) {
  return esa ? esadecimale(dati) + " " : decodificaUtf8(dati);
}

/** I byte da inviare: il testo più il fine riga scelto (chiave di FINE_RIGA). Testo con surrogati → UnicodeEncodeError. */
export function datiDaInviare(testo, fineRiga = FINE_RIGA_PREDEFINITA) {
  if (typeof fineRiga !== "string" || !Object.hasOwn(FINE_RIGA, fineRiga)) throw errorePy("KeyError", reprPy(fineRiga));
  return codificaUtf8(testo + FINE_RIGA[fineRiga]);
}

/**
 * Il testo della console, come QPlainTextEdit con setMaximumBlockCount: ogni pezzo aggiunto va in fondo; "\r\n", "\r",
 * U+2029, U+FDD0 e U+FDD1 dentro un pezzo sono un a capo; oltre `righeMax` righe le più vecchie si tolgono. Il testo
 * (`testo`, ciò che si salva) è quello di toPlainText: U+2028 diventa "\n" e lo spazio unificatore uno spazio.
 * Differenza voluta: Polpo Studio per PC perde un U+FEFF all'inizio di un pezzo (e un pezzo che inizia con U+FFFE
 * viene scambiato byte per byte) nel passaggio da Python a Qt; qui il testo resta com'è arrivato.
 */
export class Terminale {
  constructor(righeMax = RIGHE_MAX) {
    this.righeMax = righeMax;
    this._righe = [""];
  }

  aggiungi(testo) {
    const parti = testo.replace(/\r\n|[\r\u2029\ufdd0\ufdd1]/g, "\n").split("\n");
    this._righe[this._righe.length - 1] += parti[0];
    for (let i = 1; i < parti.length; i++) this._righe.push(parti[i]);
    if (this.righeMax > 0 && this._righe.length > this.righeMax) this._righe.splice(0, this._righe.length - this.righeMax);
  }

  /** Aggiunge un pezzo ricevuto (vedi `testoRicevuto`). */
  ricevi(dati, esa = false) {
    this.aggiungi(testoRicevuto(dati, esa));
  }

  get righe() {
    return this._righe.length;
  }

  /** Tutto il testo, come toPlainText. */
  get testo() {
    return this._righe.join("\n").replaceAll("\u2028", "\n").replaceAll("\u00a0", " ");
  }

  svuota() {
    this._righe = [""];
  }
}

// ---------------- testi della scheda «Console seriale» ----------------

export const TESTI = Object.freeze({
  nessunaPorta: "Nessuna porta seriale disponibile.",
  scollegata: "Porta scollegata.",
  chiusa: "Console chiusa.",
  apriPrima: "Apri prima la console.",
  salvato: "Registro salvato nella cassaforte.",
  portaChiusa: "porta chiusa",
  segnaposto: "Testo da inviare…",
  riavvia: "Riavvia la scheda all'apertura",
  esadecimale: "Esadecimale",
});

/** Il messaggio quando la console si apre. */
export function messaggioAperta(porta, baud) {
  return `Console aperta su ${porta} a ${baud} baud.`;
}

/**
 * Cosa salvare con «Salva registro» (categoria «diagnostica» della cassaforte): `null` se la console è vuota,
 * altrimenti {categoria, nome ("console-AAAAMMGG-HHMM.txt", ora locale di `adesso`), dati (UTF-8), messaggio}.
 */
export function salvataggioRegistro(testo, adesso) {
  if (!testo) return null;
  return { categoria: "diagnostica", nome: formattaData("console-%Y%m%d-%H%M.txt", adesso), dati: codificaUtf8(testo), messaggio: TESTI.salvato };
}
