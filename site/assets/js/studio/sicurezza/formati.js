// Polpo Studio — sicurezza: byte, testo, base64, JSON e zlib scritti come li scrive Python.
//
// I file della cassaforte passano dal computer (Polpo Studio in Python) al telefono e ritorno: qui ci sono le
// conversioni che devono dare esattamente gli stessi byte di Python (json.dumps, base64, zlib) e le piccole
// regole di Python che servono a leggere quei file allo stesso modo (str.strip, str.splitlines, int(), str.isdigit).

/** Equivalente di ValueError di Python: dati in un formato non valido (base64, numeri, testo UTF-8…). */
export class ErroreValore extends Error {
  constructor(messaggio) {
    super(messaggio);
    this.name = "ErroreValore";
  }
}

// ---------------- byte ----------------

const codificatore = new TextEncoder();
const decodificatoreRigido = new TextDecoder("utf-8", { fatal: true });
const decodificatoreAscii = new TextDecoder("utf-8");

/** Testo → byte UTF-8 (come `str.encode()` di Python). */
export function utf8(testo) {
  return codificatore.encode(testo);
}

/** Byte UTF-8 → testo; byte non validi → ErroreValore (come `bytes.decode()` di Python). */
export function daUtf8(byte) {
  try {
    return decodificatoreRigido.decode(byte);
  } catch {
    throw new ErroreValore("testo UTF-8 non valido");
  }
}

/** Controlla che `dati` siano byte (Uint8Array) e ne restituisce una copia. */
export function copiaByte(dati, cosa = "dati") {
  if (!(dati instanceof Uint8Array)) throw new TypeError(`${cosa}: serve un Uint8Array`);
  return dati.slice();
}

/** Unisce più Uint8Array in uno solo. */
export function unisci(...parti) {
  return unisciElenco(parti);
}

export function unisciElenco(parti) {
  let n = 0;
  for (const p of parti) n += p.length;
  const out = new Uint8Array(n);
  let i = 0;
  for (const p of parti) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

/** `n` byte casuali da `crypto.getRandomValues` (come `os.urandom`). */
export function casuali(n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) globalThis.crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65536)));
  return out;
}

const ESA = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

/** Byte → esadecimale minuscolo (come `bytes.hex()` e `hexdigest()`). */
export function esadecimale(byte) {
  let s = "";
  for (let i = 0; i < byte.length; i++) s += ESA[byte[i]];
  return s;
}

/** u32 big endian (come `struct.pack(">I", n)`). */
export function u32be(n) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n, false);
  return out;
}

// ---------------- base64 ----------------

const ALFABETO_B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const CODICI_B64 = Uint8Array.from(ALFABETO_B64, (c) => c.charCodeAt(0));
const VALORI_B64 = new Int8Array(128).fill(-1);
for (let i = 0; i < 64; i++) VALORI_B64[CODICI_B64[i]] = i;

/** Base64 standard con «=» finali (come `base64.b64encode`). */
export function inBase64(byte) {
  const n = byte.length;
  const out = new Uint8Array(Math.ceil(n / 3) * 4);
  let i = 0;
  let o = 0;
  for (; i + 2 < n; i += 3) {
    const v = (byte[i] << 16) | (byte[i + 1] << 8) | byte[i + 2];
    out[o++] = CODICI_B64[v >> 18];
    out[o++] = CODICI_B64[(v >> 12) & 63];
    out[o++] = CODICI_B64[(v >> 6) & 63];
    out[o++] = CODICI_B64[v & 63];
  }
  if (n - i === 1) {
    const v = byte[i] << 16;
    out[o++] = CODICI_B64[v >> 18];
    out[o++] = CODICI_B64[(v >> 12) & 63];
    out[o++] = 61;
    out[o++] = 61;
  } else if (n - i === 2) {
    const v = (byte[i] << 16) | (byte[i + 1] << 8);
    out[o++] = CODICI_B64[v >> 18];
    out[o++] = CODICI_B64[(v >> 12) & 63];
    out[o++] = CODICI_B64[(v >> 6) & 63];
    out[o++] = 61;
  }
  return decodificatoreAscii.decode(out);
}

/**
 * Base64 rigido, come `base64.b64decode(s, validate=True)` di Python 3.13: solo l'alfabeto standard, «=» solo in
 * fondo e nel numero giusto. I bit avanzati dell'ultimo carattere vengono ignorati, come in Python.
 */
export function daBase64(testo) {
  if (typeof testo !== "string") throw new ErroreValore("base64: serve un testo");
  let d = testo.length;
  let uguali = 0;
  while (d > 0 && testo.charCodeAt(d - 1) === 61) {
    d--;
    uguali++;
  }
  const resto = d % 4;
  if (!((resto === 0 && uguali === 0) || (resto === 2 && uguali === 2) || (resto === 3 && uguali === 1))) {
    throw new ErroreValore("base64 non valido (lunghezza o «=» sbagliati)");
  }
  const out = new Uint8Array((d * 3) >> 2);
  let o = 0;
  let acc = 0;
  let bit = 0;
  for (let i = 0; i < d; i++) {
    const c = testo.charCodeAt(i);
    const v = c < 128 ? VALORI_B64[c] : -1;
    if (v < 0) throw new ErroreValore("base64 non valido (carattere estraneo)");
    acc = ((acc << 6) | v) & 0xffffff;
    bit += 6;
    if (bit >= 8) {
      bit -= 8;
      out[o++] = (acc >> bit) & 0xff;
    }
  }
  return out;
}

// ---------------- base32 (chiave di recupero) ----------------

export const ALFABETO_B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Base32 RFC 4648 senza «=» (la chiave di recupero ha 20 byte = 32 caratteri esatti). */
export function inBase32(byte) {
  let s = "";
  let acc = 0;
  let bit = 0;
  for (const b of byte) {
    acc = ((acc << 8) | b) & 0xffff;
    bit += 8;
    while (bit >= 5) {
      bit -= 5;
      s += ALFABETO_B32[(acc >> bit) & 31];
    }
  }
  if (bit > 0) s += ALFABETO_B32[(acc << (5 - bit)) & 31];
  return s;
}

export function daBase32(testo) {
  const out = new Uint8Array(Math.floor((testo.length * 5) / 8));
  let acc = 0;
  let bit = 0;
  let o = 0;
  for (const ch of testo) {
    const v = ALFABETO_B32.indexOf(ch);
    if (v < 0) throw new ErroreValore("base32 non valido");
    acc = ((acc << 5) | v) & 0xffff;
    bit += 5;
    if (bit >= 8) {
      bit -= 8;
      out[o++] = (acc >> bit) & 0xff;
    }
  }
  return out;
}

// ---------------- regole di Python sul testo ----------------

// Caratteri per cui `str.isspace()` è vero.
const SPAZI = "\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const RE_BORDI = new RegExp(`^[${SPAZI}]+|[${SPAZI}]+$`, "g");
const RE_VUOTA = new RegExp(`^[${SPAZI}]*$`);
// Separatori di `str.splitlines()` (dopo la conversione dei ritorni a capo di `read_text`).
const RE_RIGHE = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;

/** `str.strip()` */
export function stripPython(testo) {
  return testo.replace(RE_BORDI, "");
}

/** `not s.strip()` */
export function vuotaPython(testo) {
  return RE_VUOTA.test(testo);
}

/** Le righe non vuote di un file di testo, come `[x for x in read_text().splitlines() if x.strip()]`. */
export function righeNonVuote(testo) {
  return testo.split(RE_RIGHE).filter((r) => !vuotaPython(r));
}

/** `len(s)` di Python: conta i caratteri Unicode, non le unità UTF-16. */
export function lunghezzaPython(testo) {
  let n = 0;
  for (let i = 0; i < testo.length; i++) {
    const c = testo.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < testo.length) {
      const d = testo.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    n++;
  }
  return n;
}

/**
 * `s.isdigit()` per i PIN: vero se `s` non è vuoto e ha solo cifre decimali Unicode (0-9 e le cifre degli altri
 * alfabeti). Python accetta anche gli esponenti (²) e le cifre cerchiate (①): qui no (JavaScript non sa
 * riconoscerli), ma un PIN così non si digita da una tastiera numerica.
 */
export function soloCifre(testo) {
  return typeof testo === "string" && /^\p{Nd}+$/u.test(testo);
}

/** Verità alla Python: falsi None, False, 0, "" e contenitori vuoti. */
export function veroPython(v) {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

/** `int(v)` di Python per i valori che arrivano da JSON (numeri, testi di cifre, booleani). */
export function interoPython(v) {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new ErroreValore(`numero non valido: ${v}`);
    return Math.trunc(v) || 0;
  }
  if (typeof v === "string") {
    const m = /^\s*([+-]?)(\d+(?:_\d+)*)\s*$/.exec(v);
    if (!m) throw new ErroreValore(`numero non valido: ${v}`);
    return Number(m[1] + m[2].replaceAll("_", "")) || 0;
  }
  throw new TypeError(`numero non valido: ${typeof v}`);
}

/** `str(v)` di Python per i valori semplici di JSON. */
export function strPython(v) {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return numeroPython(v);
  return jsonPython(v);
}

// ---------------- JSON come json.dumps ----------------

/** Un numero come lo scrive `json.dumps` (i numeri interi come int, gli altri come `repr(float)`). */
function numeroPython(x) {
  if (!Number.isFinite(x)) return "null"; // JSON.stringify fa lo stesso; Python scriverebbe NaN/Infinity
  if (Number.isInteger(x) && Math.abs(x) < 1e21) return String(x === 0 ? 0 : x);
  const a = Math.abs(x);
  if (a >= 1e-4 && a < 1e16) return String(x); // stesse cifre e stessa forma di repr()
  const [mantissa, esponente] = x.toExponential().split("e");
  const e = Number(esponente);
  return `${mantissa}e${e < 0 ? "-" : "+"}${String(Math.abs(e)).padStart(2, "0")}`;
}

function testoPython(s, soloAscii) {
  const t = JSON.stringify(s);
  if (!soloAscii || !/[^\x00-\x7e]/.test(t)) return t;
  return t.replace(/[\x7f-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

/**
 * Come `json.dumps(valore, ensure_ascii=soloAscii, indent=rientro)` di Python: stessi separatori («, » e «: »),
 * stessi \uXXXX, stessa forma dei numeri, chiavi nell'ordine di inserimento.
 * (Gli oggetti JavaScript mettono prima le chiavi che sembrano numeri interi: per i nostri file non succede.)
 */
export function jsonPython(valore, { soloAscii = true, rientro = null } = {}) {
  return serializza(valore, soloAscii, rientro, 0);
}

function serializza(v, soloAscii, rientro, livello) {
  if (v === null || v === undefined) return "null";
  if (v === true) return "true";
  if (v === false) return "false";
  if (typeof v === "number") return numeroPython(v);
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string") return testoPython(v, soloAscii);
  const voci = [];
  if (Array.isArray(v)) {
    for (const x of v) voci.push(serializza(x, soloAscii, rientro, livello + 1));
  } else if (typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (x === undefined || typeof x === "function" || typeof x === "symbol") continue;
      voci.push(testoPython(k, soloAscii) + ": " + serializza(x, soloAscii, rientro, livello + 1));
    }
  } else {
    throw new TypeError(`non serializzabile in JSON: ${typeof v}`);
  }
  const [apre, chiude] = Array.isArray(v) ? ["[", "]"] : ["{", "}"];
  if (!voci.length) return apre + chiude;
  if (rientro === null) return apre + voci.join(", ") + chiude;
  const dentro = "\n" + " ".repeat(rientro * (livello + 1));
  return apre + dentro + voci.join("," + dentro) + "\n" + " ".repeat(rientro * livello) + chiude;
}

// ---------------- zlib ----------------

// «deflate» dei Compression Streams è il formato zlib (RFC 1950), lo stesso di `zlib.compress` di Python.

/** Come `zlib.compress(dati)` (livello predefinito di zlib, 6). */
export function comprimi(dati) {
  return trasforma(dati, new CompressionStream("deflate"));
}

/** Come `zlib.decompress(dati)`; dati non validi → ErroreValore. */
export async function decomprimi(dati) {
  try {
    return await trasforma(dati, new DecompressionStream("deflate"));
  } catch (e) {
    if (e instanceof TypeError) throw new ErroreValore("dati compressi non validi");
    throw e;
  }
}

async function trasforma(dati, flusso) {
  const scrittore = flusso.writable.getWriter();
  const scrittura = scrittore.write(dati).then(() => scrittore.close());
  scrittura.catch(() => {}); // l'errore arriva anche dal lettore
  const lettore = flusso.readable.getReader();
  const pezzi = [];
  for (;;) {
    const { value, done } = await lettore.read();
    if (done) break;
    pezzi.push(value);
  }
  await scrittura;
  return unisciElenco(pezzi);
}
