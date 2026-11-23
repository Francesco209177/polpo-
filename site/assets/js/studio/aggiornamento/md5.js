// MD5 (RFC 1321) per l'aggiornamento del firmware.
//
// Non è una protezione: l'impronta che conta è la SHA-256 (WebCrypto) controllata prima di cominciare. L'MD5 serve
// solo per il controllo che fa esptool dopo la scrittura: il programma di scrittura sul Polpo calcola l'MD5 della
// memoria appena scritta e lo confronta con questo. WebCrypto non offre l'MD5, quindi è scritto qui.

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
// K[i] = parte intera di |sin(i + 1)| * 2^32 (RFC 1321, paragrafo 3.4)
const K = Int32Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0);

/** L'MD5 di `byte` (Uint8Array), in esadecimale minuscolo come lo stampa esptool. */
export function md5(byte) {
  const n = byte.length;
  const lunghezza = (((n + 8) >>> 6) + 1) * 64; // messaggio + 0x80 + lunghezza in 64 bit, a blocchi di 64 byte
  const buf = new Uint8Array(lunghezza);
  buf.set(byte);
  buf[n] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(lunghezza - 8, (n * 8) >>> 0, true);
  dv.setUint32(lunghezza - 4, Math.floor(n / 0x20000000), true);

  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
  const M = new Int32Array(16);
  for (let blocco = 0; blocco < lunghezza; blocco += 64) {
    for (let j = 0; j < 16; j++) M[j] = dv.getInt32(blocco + 4 * j, true);
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) & 15; }
      else { f = c ^ (b | ~d); g = (7 * i) & 15; }
      const t = (a + f + K[i] + M[g]) | 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((t << S[i]) | (t >>> (32 - S[i])))) | 0;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }
  let esa = "";
  for (const x of [a0, b0, c0, d0]) {
    for (let k = 0; k < 4; k++) esa += ((x >>> (8 * k)) & 0xff).toString(16).padStart(2, "0");
  }
  return esa;
}
