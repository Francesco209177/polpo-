// Polpo Studio — calcolatore di controlli: CRC8 Dallas/Maxim, CRC16 (CCITT e Modbus), CRC32, SHA-256.
// Copia JavaScript di studio/polpo_studio/apps/crc_tool.py. Tutto calcolato qui, senza librerie.

import { crc8 } from "../protocolli/onewire.js";
import { codificaUtf8, eValueErrorPy, formatIntPy, fromhexPy, hexPy, splitPy } from "./convertitore.js";

export { crc8 };

export const MANIFEST = Object.freeze({
  id: "calcolatore_crc",
  name: "Calcolatore CRC e impronte",
  description: "CRC8 Dallas/Maxim, CRC16-CCITT, CRC16-Modbus, CRC32 e SHA-256 di testo o byte esadecimali.",
  version: "1.0",
  category: "strumenti",
  author: "Progetto Polpo",
  icon: "apps",
});

/** Valore iniziale del campo. */
export const ESEMPIO = "123456789";

/** CRC16-CCITT (polinomio 0x1021, valore iniziale 0xFFFF se non indicato). Per «123456789» vale 0x29B1. */
export function crc16Ccitt(dati, crc = 0xffff) {
  for (const b of dati) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/** CRC16-Modbus (polinomio riflesso 0xA001, valore iniziale 0xFFFF). Per «123456789» vale 0x4B37. */
export function crc16Modbus(dati) {
  let crc = 0xffff;
  for (const b of dati) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}

const TABELLA_CRC32 = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC32 come zlib.crc32 (polinomio 0x04C11DB7 riflesso). Per «123456789» vale 0xCBF43926. */
export function crc32(dati) {
  let c = 0xffffffff;
  for (const b of dati) c = TABELLA_CRC32[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const K_SHA256 = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Impronta SHA-256 (32 byte). */
export function sha256(dati) {
  const m = Uint8Array.from(dati);
  const lunghezza = m.length;
  const blocchi = Math.ceil((lunghezza + 9) / 64);
  const buf = new Uint8Array(blocchi * 64);
  buf.set(m);
  buf[lunghezza] = 0x80;
  const vista = new DataView(buf.buffer);
  vista.setUint32(buf.length - 8, Math.floor(lunghezza / 0x20000000));
  vista.setUint32(buf.length - 4, (lunghezza * 8) >>> 0);
  const h = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rot = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < buf.length; off += 64) {
    for (let t = 0; t < 16; t++) w[t] = vista.getUint32(off + 4 * t);
    for (let t = 16; t < 64; t++) {
      const s0 = rot(w[t - 15], 7) ^ rot(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rot(w[t - 2], 17) ^ rot(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, k] = h;
    for (let t = 0; t < 64; t++) {
      const t1 = (k + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K_SHA256[t] + w[t]) >>> 0;
      const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      k = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += k;
  }
  const out = new Uint8Array(32);
  const vo = new DataView(out.buffer);
  h.forEach((x, i) => vo.setUint32(4 * i, x));
  return out;
}

/** Tutti i controlli di `dati`, con le etichette della pagina. */
export function controlli(dati) {
  return {
    "CRC8 Dallas/Maxim": formatIntPy(crc8(dati), "02X"),
    "CRC16-CCITT (FFFF)": formatIntPy(crc16Ccitt(dati), "04X"),
    "CRC16-Modbus": formatIntPy(crc16Modbus(dati), "04X"),
    CRC32: formatIntPy(crc32(dati), "08X"),
    "SHA-256": hexPy(sha256(dati)),
  };
}

/**
 * Come la pagina: `testo` letto come byte esadecimali (spazi ammessi ovunque) se `esadecimale`, altrimenti come
 * testo UTF-8. Se non è valido, ogni riga mostra «esadecimale non valido».
 */
export function controlliDaTesto(testo, esadecimale) {
  let dati;
  try {
    dati = esadecimale ? fromhexPy(splitPy(testo).join("")) : codificaUtf8(testo);
  } catch (e) {
    if (!eValueErrorPy(e)) throw e;
    return Object.fromEntries(Object.keys(controlli([])).map((k) => [k, "esadecimale non valido"]));
  }
  return controlli(dati);
}
