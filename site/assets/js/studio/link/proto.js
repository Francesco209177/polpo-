// Polpo Link: protocollo a righe JSON tra il programma (Polpo Studio, l'app) e il Polpo, via USB.
// È la copia JavaScript di studio/polpo_studio/protocols/link.py (parte del client): stesse costanti, stessa
// tabella dei comandi, stesse regole su percorsi e blocchi. Le prove la confrontano con il firmware.
//
//   richiesta  {"id":7,"cmd":"ir.send","args":{...}}
//   risposta   {"id":7,"ok":true,"data":{...}}   oppure   {"id":7,"ok":false,"error":{"code":"...","msg":"..."}}
//   evento     {"ev":"rf.code","data":{...}}

export const VERSIONE_PROTOCOLLO = 1;
export const RIGA_MAX = 2048; // byte per riga inviata al Polpo
export const BLOCCO_MAX = 768; // byte di file per blocco fs.read / fs.write
export const FILE_MAX = 256 * 1024;
// Le risposte del Polpo possono superare 2 KB (elenco reti, pagine NFC): chi riceve accetta righe più lunghe.
export const RIGA_IN_ARRIVO_MAX = 64 * 1024;

/** I comandi: [nome, serve la sessione accettata sul Polpo, chiede conferma sullo schermo del Polpo a ogni uso]. */
const TABELLA = [
  ["ping", false, false],
  ["hello", false, false],
  ["info", true, false],
  ["diag", true, false],
  ["bye", true, false],
  ["fs.list", true, false],
  ["fs.read", true, false],
  ["fs.write", true, false], // sensibile solo in /polpo/badusb
  ["fs.delete", true, false],
  ["ir.send", true, false],
  ["ir.learn.start", true, false],
  ["ir.learn.stop", true, false],
  ["rf.rx.start", true, false],
  ["rf.rx.stop", true, false],
  ["rf.raw.start", true, false],
  ["rf.raw.snapshot", true, false],
  ["rf.raw.stop", true, false],
  ["rf.tx", true, true],
  ["nfc.read", true, false],
  ["nfc.write_ndef", true, true],
  ["wifi.scan", true, false],
  ["ble.scan", true, false],
  ["gpio.i2c_scan", true, false],
  ["gpio.pins", true, false],
  ["script.check", true, false],
  ["script.run", true, true],
  ["script.stop", true, false],
  ["script.pause", true, false],
  ["script.resume", true, false],
  ["script.step", true, false],
  ["script.breakpoints", true, false],
  ["script.state", true, false],
];
export const COMANDI = Object.freeze(Object.fromEntries(TABELLA.map(([nome, sessione, sensibile]) => [nome, Object.freeze({ nome, sessione, sensibile })])));

export const CODICI_ERRORE = Object.freeze([
  "bad_args", "io_error", "no_hardware", "too_large", "denied", "timeout", "unsupported", "budget", "busy",
  "not_connected", "unknown_cmd", "bad_json", "bad_request", "line_too_long",
]);

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });

/** Una riga compatta in UTF-8, senza il «\n» finale (come serializeJson del firmware). */
export function codifica(oggetto) {
  return enc.encode(JSON.stringify(oggetto));
}

/** Testo UTF-8 di una riga; null se i byte non sono UTF-8 valido. */
export function testoRiga(byte) {
  try { return dec.decode(byte); } catch { return null; }
}

/**
 * Divide il flusso in righe terminate da «\n»; «\r» è ignorato. Una riga oltre `rigaMax` byte viene scartata fino al
 * «\n» successivo e segnalata una sola volta con `null`, come polpo::link::LineFramer.
 */
export class DivisoreRighe {
  constructor(rigaMax = RIGA_MAX) {
    this.rigaMax = rigaMax;
    this._buf = new Uint8Array(Math.min(rigaMax, 4096));
    this._n = 0;
    this._troppo = false;
  }

  /** @param {Uint8Array} dati  @returns {(Uint8Array|null)[]} le righe complete */
  aggiungi(dati) {
    const uscita = [];
    for (const b of dati) {
      if (b === 0x0a) {
        if (this._troppo) this._troppo = false;
        else uscita.push(this._buf.slice(0, this._n));
        this._n = 0;
        continue;
      }
      if (b === 0x0d || this._troppo) continue;
      if (this._n >= this.rigaMax) {
        this._troppo = true;
        this._n = 0;
        uscita.push(null);
        continue;
      }
      if (this._n === this._buf.length) {
        const nuovo = new Uint8Array(Math.min(this.rigaMax, this._buf.length * 2));
        nuovo.set(this._buf);
        this._buf = nuovo;
      }
      this._buf[this._n++] = b;
    }
    return uscita;
  }
}

// ---------------- codifiche ----------------

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_VAL = new Int16Array(128).fill(-1);
for (let i = 0; i < 64; i++) B64_VAL[B64.charCodeAt(i)] = i;

/** Base64 RFC 4648 con «=». */
export function base64(dati) {
  let s = "";
  for (let i = 0; i < dati.length; i += 3) {
    const a = dati[i], b = dati[i + 1], c = dati[i + 2];
    s += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    s += b === undefined ? "=" : B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    s += c === undefined ? "=" : B64[c & 63];
  }
  return s;
}

/** Base64 RFC 4648 rigoroso; null se non valido (come link.b64decode). */
export function daBase64(testo) {
  if (typeof testo !== "string" || testo.length % 4) return null;
  const pad = testo.endsWith("==") ? 2 : testo.endsWith("=") ? 1 : 0;
  const n = (testo.length / 4) * 3 - pad;
  const out = new Uint8Array(n);
  let o = 0;
  for (let i = 0; i < testo.length; i += 4) {
    const v = [0, 1, 2, 3].map((k) => {
      const ch = testo.charCodeAt(i + k);
      if (testo[i + k] === "=" && i + 4 === testo.length && k >= 4 - pad) return 0;
      return ch < 128 ? B64_VAL[ch] : -1;
    });
    if (v.some((x) => x < 0)) return null;
    const x = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3];
    if (o < n) out[o++] = (x >> 16) & 255;
    if (o < n) out[o++] = (x >> 8) & 255;
    if (o < n) out[o++] = x & 255;
  }
  return out;
}

const CRC_TAB = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (quella di zlib). Per «123456789» vale 0xCBF43926. */
export function crc32(dati, prec = 0) {
  let c = (prec ^ 0xffffffff) >>> 0;
  for (const b of dati) c = CRC_TAB[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const CARATTERI_PERCORSO = new Set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-./");

/** Solo percorsi dentro /polpo, senza «..», con caratteri semplici, al massimo 96 caratteri. */
export function percorsoValido(p) {
  if (typeof p !== "string" || p.length < 6 || p.length > 96) return false;
  if (!p.startsWith("/polpo") || (p.length > 6 && p[6] !== "/")) return false;
  if (p.includes("..") || p.includes("//")) return false;
  for (const c of p) if (!CARATTERI_PERCORSO.has(c)) return false;
  return true;
}

/** Gli script in /polpo/badusb si scrivono solo con conferma sul Polpo. */
export function percorsoSensibile(p) {
  return p.startsWith("/polpo/badusb/");
}

/** Byte in esadecimale maiuscolo, con un separatore facoltativo. */
export function esadecimale(dati, sep = "") {
  return Array.from(dati, (b) => b.toString(16).toUpperCase().padStart(2, "0")).join(sep);
}
