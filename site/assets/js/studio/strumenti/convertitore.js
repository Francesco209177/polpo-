// Polpo Studio — convertitore di numeri e testo: decimale, esadecimale, binario, ASCII, Base64.
// Copia JavaScript di studio/polpo_studio/apps/converter.py.
//
// Qui ci sono anche le regole di Python che servono agli altri moduli dello Studio portati in JavaScript:
// int(), float(), str(), repr(), strip(), split(), isdigit(), bytes.fromhex(), bytes.hex(), round(),
// format() dei numeri, codifiche UTF-8/UTF-16/ASCII, Base64. Con le stesse regole lo stesso testo scritto
// dall'utente dà lo stesso risultato del programma per PC (anche negli errori: stesso tipo, stesso messaggio).
// Le prove in site/tests/studio/nfc_vari/ lo verificano con casi generati eseguendo il codice Python.

export const MANIFEST = Object.freeze({
  id: "convertitore",
  name: "Convertitore",
  description: "Converte numeri e byte tra decimale, esadecimale, binario, testo ASCII e Base64.",
  version: "1.0",
  category: "convertitori",
  author: "Progetto Polpo",
  icon: "apps",
});

/** Tipi di ingresso nell'ordine del menu: [chiave, nome]. */
export const TIPI_INGRESSO = Object.freeze([
  ["hex", "Esadecimale"],
  ["dec", "Decimale"],
  ["bin", "Binario"],
  ["text", "Testo"],
  ["b64", "Base64"],
]);

/** Le righe di uscita nell'ordine della pagina: [chiave, nome]. */
export const USCITE = Object.freeze([
  ["dec", "Decimale"],
  ["hex", "Esadecimale"],
  ["bin", "Binario"],
  ["ascii", "ASCII"],
  ["b64", "Base64"],
]);

/** Valore iniziale del campo. */
export const ESEMPIO = "50 6F 6C 70 6F";

/** Interpreta `testo` come `tipo` ("dec", "hex", "bin", "b64", altrimenti testo) e restituisce tutte le rappresentazioni. */
export function converti(testo, tipo) {
  const t = stripPy(testo);
  let dati;
  if (tipo === "dec") {
    const v = intPy(t);
    dati = interoInByte(v, Math.max(1, Math.floor((lunghezzaBit(v) + 7) / 8)));
  } else if (tipo === "hex") {
    let h = splitPy(t).join("");
    if (h.startsWith("0x")) h = h.slice(2);
    dati = fromhexPy(lunghezzaPy(h) % 2 === 0 ? h : "0" + h);
  } else if (tipo === "bin") {
    let b = splitPy(t).join("");
    if (b.startsWith("0b")) b = b.slice(2);
    dati = interoInByte(intPy(b, 2), Math.max(1, Math.floor((lunghezzaPy(b) + 7) / 8)));
  } else if (tipo === "b64") {
    dati = decodificaBase64(t);
  } else {
    dati = codificaUtf8(t);
  }
  const valore = interoDaByte(dati);
  return {
    dec: strInteroPy(valore),
    hex: hexPy(dati, " ").toUpperCase(),
    bin: Array.from(dati, (b) => b.toString(2).padStart(8, "0")).join(" "),
    ascii: Array.from(dati, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "·")).join(""),
    b64: codificaBase64(dati),
  };
}

/** Come la pagina del convertitore: se il valore non è valido tutte le righe mostrano «—». */
export function convertiPerVista(testo, tipo) {
  try {
    return converti(testo, tipo);
  } catch (e) {
    if (!eValueErrorPy(e)) throw e;
    return Object.fromEntries(USCITE.map(([k]) => [k, "—"]));
  }
}

// ======================================================================================================
// Regole di Python
// ======================================================================================================

/** Errore che corrisponde a un'eccezione Python: `tipo` è il nome della classe (es. "ValueError"), il messaggio è lo stesso. */
export function errorePy(tipo, messaggio) {
  const e = new Error(messaggio);
  e.tipo = tipo;
  return e;
}

// In Python queste eccezioni sono sottoclassi di ValueError: un `except ValueError` le prende tutte.
const SOTTOCLASSI_VALUE_ERROR = new Set(["ValueError", "binascii.Error", "UnicodeError", "UnicodeEncodeError", "UnicodeDecodeError"]);

/** Vero se `e` è un errore che in Python un `except ValueError` prenderebbe. */
export function eValueErrorPy(e) {
  return e instanceof Error && SOTTOCLASSI_VALUE_ERROR.has(e.tipo);
}

// ---------------- spazi e cifre (tabelle Unicode 15.1 di Python 3.13) ----------------

// I caratteri per cui str.isspace() è vero: li usano strip() e split().
const SPAZI = new Set([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004,
  0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
]);

// Le cifre decimali Unicode (str.isdecimal()) sono in blocchi di 10 caratteri consecutivi, da 0 a 9: qui l'inizio di ogni blocco.
const INIZI_DECIMALI = [
  0x30, 0x660, 0x6f0, 0x7c0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66, 0xde6, 0xe50, 0xed0, 0xf20,
  0x1040, 0x1090, 0x17e0, 0x1810, 0x1946, 0x19d0, 0x1a80, 0x1a90, 0x1b50, 0x1bb0, 0x1c40, 0x1c50, 0xa620, 0xa8d0, 0xa900,
  0xa9d0, 0xa9f0, 0xaa50, 0xabf0, 0xff10, 0x104a0, 0x10d30, 0x11066, 0x110f0, 0x11136, 0x111d0, 0x112f0, 0x11450, 0x114d0,
  0x11650, 0x116c0, 0x11730, 0x118e0, 0x11950, 0x11c50, 0x11d50, 0x11da0, 0x11f50, 0x16a60, 0x16ac0, 0x16b50, 0x1d7ce,
  0x1d7d8, 0x1d7e2, 0x1d7ec, 0x1d7f6, 0x1e140, 0x1e2f0, 0x1e4f0, 0x1e950, 0x1fbf0,
];

// Altri caratteri per cui str.isdigit() è vero ma che int() non accetta (esponenti, cifre cerchiate...).
const SOLO_CIFRE = [
  [0xb2, 0xb3], [0xb9, 0xb9], [0x1369, 0x1371], [0x19da, 0x19da], [0x2070, 0x2070], [0x2074, 0x2079], [0x2080, 0x2089],
  [0x2460, 0x2468], [0x2474, 0x247c], [0x2488, 0x2490], [0x24ea, 0x24ea], [0x24f5, 0x24fd], [0x24ff, 0x24ff],
  [0x2776, 0x277e], [0x2780, 0x2788], [0x278a, 0x2792], [0x10a40, 0x10a43], [0x10e60, 0x10e68], [0x11052, 0x1105a],
  [0x1f100, 0x1f10a],
];

/** Vero se il codice `cp` è uno spazio per Python (str.isspace()). */
export function eSpazioPy(cp) {
  return SPAZI.has(cp);
}

/** Valore 0-9 di una cifra decimale Unicode, -1 se `cp` non lo è. */
function valoreDecimale(cp) {
  let lo = 0;
  let hi = INIZI_DECIMALI.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (INIZI_DECIMALI[m] <= cp) lo = m + 1;
    else hi = m - 1;
  }
  return hi >= 0 && cp < INIZI_DECIMALI[hi] + 10 ? cp - INIZI_DECIMALI[hi] : -1;
}

/** Come str.isdigit(): vero se il testo non è vuoto ed è fatto solo di cifre (anche non latine). */
export function isdigitPy(s) {
  if (!s) return false;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (valoreDecimale(cp) < 0 && !SOLO_CIFRE.some(([a, b]) => cp >= a && cp <= b)) return false;
  }
  return true;
}

/** Come str.isascii(). */
export function isasciiPy(s) {
  return /^[\x00-\x7f]*$/.test(s);
}

/** Come len() su un testo: conta i caratteri Unicode, non le unità UTF-16. */
export function lunghezzaPy(s) {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** Come str.strip() senza argomenti. */
export function stripPy(s) {
  let a = 0;
  let b = s.length;
  while (a < b && SPAZI.has(s.charCodeAt(a))) a++;
  while (b > a && SPAZI.has(s.charCodeAt(b - 1))) b--;
  return s.slice(a, b);
}

/** Come str.split() senza separatore (dividi sugli spazi), con `massimo` divisioni come maxsplit (-1 = tutte). */
export function splitPy(s, massimo = -1) {
  const out = [];
  const n = s.length;
  let i = 0;
  let resto = massimo < 0 ? Infinity : massimo;
  while (resto-- > 0) {
    while (i < n && SPAZI.has(s.charCodeAt(i))) i++;
    if (i === n) break;
    const j = i++;
    while (i < n && !SPAZI.has(s.charCodeAt(i))) i++;
    out.push(s.slice(j, i));
  }
  if (i < n) {
    while (i < n && SPAZI.has(s.charCodeAt(i))) i++;
    if (i !== n) out.push(s.slice(i));
  }
  return out;
}

// ---------------- str(), repr(), tipi ----------------

// Caratteri che repr() mostra con una sequenza di escape (str.isprintable() falso).
const NON_STAMPABILE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;

/** Nome del tipo Python che corrisponde a un valore JSON (per i messaggi di errore). */
export function nomeTipoPy(v) {
  if (v === null || v === undefined) return "NoneType";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "bigint") return "int";
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "float";
  if (typeof v === "string") return "str";
  if (Array.isArray(v)) return "list";
  return "dict";
}

/** Come repr() di un numero decimale (float) di Python. */
function reprFloat(x) {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x < 0 ? "-inf" : "inf";
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const [m, e] = x.toExponential().split("e"); // le cifre più corte che ridanno lo stesso numero, come Python
  const segno = x < 0 ? "-" : "";
  const cifre = m.replace("-", "").replace(".", "");
  const punto = Number(e) + 1;
  if (punto > -4 && punto <= 16) {
    if (punto <= 0) return segno + "0." + "0".repeat(-punto) + cifre;
    if (punto >= cifre.length) return segno + cifre + "0".repeat(punto - cifre.length) + ".0";
    return segno + cifre.slice(0, punto) + "." + cifre.slice(punto);
  }
  const esp = punto - 1;
  return segno + cifre[0] + (cifre.length > 1 ? "." + cifre.slice(1) : "") + "e" + (esp < 0 ? "-" : "+") + String(Math.abs(esp)).padStart(2, "0");
}

/**
 * Come str() di Python per i valori che arrivano da JSON (null → "None", true → "True", liste e oggetti come in Python).
 * Un numero intero in JavaScript non distingue 5 da 5.0: è trattato come int.
 */
export function strPy(v) {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return Number.isInteger(v) ? BigInt(v).toString() : reprFloat(v);
  if (Array.isArray(v)) return "[" + v.map(reprPy).join(", ") + "]";
  return "{" + Object.entries(v).map(([k, x]) => reprPy(k) + ": " + reprPy(x)).join(", ") + "}";
}

/** Come repr() di Python: i testi tra apici con le sequenze di escape, gli altri valori come str(). */
export function reprPy(v) {
  if (typeof v !== "string") return strPy(v);
  const apice = v.includes("'") && !v.includes('"') ? '"' : "'";
  let out = apice;
  for (const ch of v) {
    const cp = ch.codePointAt(0);
    if (ch === apice || ch === "\\") out += "\\" + ch;
    else if (ch === "\t") out += "\\t";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (cp < 0x20 || cp === 0x7f) out += "\\x" + cp.toString(16).padStart(2, "0");
    else if (cp < 0x7f || ch === " " || !NON_STAMPABILE.test(ch)) out += ch;
    else if (cp <= 0xff) out += "\\x" + cp.toString(16).padStart(2, "0");
    else if (cp <= 0xffff) out += "\\u" + cp.toString(16).padStart(4, "0");
    else out += "\\U" + cp.toString(16).padStart(8, "0");
  }
  return out + apice;
}

/** Come bool() di Python: falsi null, false, 0, testi, liste e oggetti vuoti. */
export function veroPy(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "bigint") return v !== 0n;
  if (typeof v === "string" || Array.isArray(v)) return v.length > 0;
  return Object.keys(v).length > 0;
}

/** Come `v != 0` in Python: solo numeri e booleani possono essere uguali a zero. */
export function diversoDaZeroPy(v) {
  if (typeof v === "number") return v !== 0;
  if (typeof v === "boolean") return v;
  if (typeof v === "bigint") return v !== 0n;
  return true;
}

/** Come dict.get(chiave, predefinito) su un oggetto arrivato da JSON. */
export function prendiPy(oggetto, chiave, predefinito = null) {
  return Object.prototype.hasOwnProperty.call(oggetto, chiave) && oggetto[chiave] !== undefined ? oggetto[chiave] : predefinito;
}

// ---------------- int() e float() ----------------

const LIMITE_CIFRE = 4300; // sys.get_int_max_str_digits() di Python

function eSpazioAscii(c) {
  return c === " " || (c >= "\t" && c <= "\r");
}

function valoreCifra(c) {
  const k = c.charCodeAt(0);
  if (k >= 48 && k <= 57) return k - 48;
  if (k >= 65 && k <= 90) return k - 55;
  if (k >= 97 && k <= 122) return k - 87;
  return 37;
}

// Come _PyUnicode_TransformDecimalAndSpaceToASCII: le cifre Unicode diventano 0-9, gli spazi Unicode " ".
function inAscii(testo) {
  let a = "";
  for (const ch of testo) {
    const cp = ch.codePointAt(0);
    if (cp < 127) a += ch;
    else if (SPAZI.has(cp)) a += " ";
    else {
      const d = valoreDecimale(cp);
      if (d < 0) return a + "?";
      a += String.fromCharCode(48 + d);
    }
  }
  return a;
}

function intDaTesto(testo, base) {
  if (base < 2 || base > 36) throw errorePy("ValueError", "int() arg 2 must be >= 2 and <= 36");
  const errore = () => errorePy("ValueError", `invalid literal for int() with base ${base}: ${Array.from(reprPy(testo)).slice(0, 200).join("")}`);
  const a = inAscii(testo);
  const n = a.length;
  let i = 0;
  while (i < n && eSpazioAscii(a[i])) i++;
  let negativo = false;
  if (a[i] === "+") i++;
  else if (a[i] === "-") {
    i++;
    negativo = true;
  }
  const prefisso = { 16: "xX", 8: "oO", 2: "bB" }[base];
  if (a[i] === "0" && prefisso && i + 1 < n && prefisso.includes(a[i + 1])) {
    i += 2;
    if (a[i] === "_") i++; // un trattino basso è ammesso dopo il prefisso
  }
  const inizio = i;
  if (a[i] === "_") throw errore();
  let prima = "";
  let cifre = "";
  while (i < n && (valoreCifra(a[i]) < base || a[i] === "_")) {
    if (a[i] === "_") {
      if (prima === "_") throw errore();
    } else cifre += a[i];
    prima = a[i++];
  }
  if (prima === "_" || i === inizio) throw errore();
  while (i < n && eSpazioAscii(a[i])) i++;
  if (i !== n) throw errore();
  if ((base & (base - 1)) !== 0 && cifre.length > LIMITE_CIFRE) {
    throw errorePy(
      "ValueError",
      `Exceeds the limit (${LIMITE_CIFRE} digits) for integer string conversion: value has ${cifre.length} digits; use sys.set_int_max_str_digits() to increase the limit`,
    );
  }
  let v;
  if (base === 10) v = BigInt(cifre);
  else if (base === 16) v = BigInt("0x" + cifre);
  else if (base === 8) v = BigInt("0o" + cifre);
  else if (base === 2) v = BigInt("0b" + cifre);
  else {
    v = 0n;
    for (const c of cifre) v = v * BigInt(base) + BigInt(valoreCifra(c));
  }
  return negativo ? -v : v;
}

/**
 * Come int(valore) o int(testo, base) di Python; restituisce un BigInt.
 * Accetta segno, spazi intorno, trattini bassi tra le cifre, il prefisso 0x/0o/0b della base e le cifre non latine.
 */
export function intPy(valore, base) {
  if (typeof valore === "string") return intDaTesto(valore, base ?? 10);
  if (base !== undefined) throw errorePy("TypeError", "int() can't convert non-string with explicit base");
  if (typeof valore === "bigint") return valore;
  if (typeof valore === "boolean") return valore ? 1n : 0n;
  if (typeof valore === "number") {
    if (Number.isNaN(valore)) throw errorePy("ValueError", "cannot convert float NaN to integer");
    if (!Number.isFinite(valore)) throw errorePy("OverflowError", "cannot convert float infinity to integer");
    return BigInt(Math.trunc(valore));
  }
  throw errorePy("TypeError", `int() argument must be a string, a bytes-like object or a real number, not '${nomeTipoPy(valore)}'`);
}

/** Come float(testo) di Python: spazi intorno, trattini bassi tra le cifre, "inf", "nan", cifre non latine. */
export function floatPy(valore) {
  if (typeof valore === "number") return valore;
  if (typeof valore !== "string") throw errorePy("TypeError", `float() argument must be a string or a real number, not '${nomeTipoPy(valore)}'`);
  const errore = () => errorePy("ValueError", `could not convert string to float: ${reprPy(valore)}`);
  let a = inAscii(valore);
  if (a.includes("\0")) throw errore();
  if (a.includes("_")) {
    let senza = "";
    let prima = "";
    for (const c of a) {
      const cifra = c >= "0" && c <= "9";
      if (c === "_") {
        if (!(prima >= "0" && prima <= "9")) throw errore();
      } else {
        senza += c;
        if (prima === "_" && !cifra) throw errore();
      }
      prima = c;
    }
    if (prima === "_") throw errore();
    a = senza;
  }
  let i = 0;
  let j = a.length;
  while (i < j && eSpazioAscii(a[i])) i++;
  if (i === j) throw errore();
  while (j > i + 1 && eSpazioAscii(a[j - 1])) j--;
  const s = a.slice(i, j);
  if (/^[+-]?(inf|infinity)$/i.test(s)) return s[0] === "-" ? -Infinity : Infinity;
  if (/^[+-]?nan$/i.test(s)) return NaN;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) throw errore();
  return Number(s);
}

/** Come str() di un intero grande: oltre 4300 cifre Python rifiuta la conversione. */
export function strInteroPy(v) {
  const s = (v < 0n ? -v : v).toString();
  if (s.length > LIMITE_CIFRE) {
    throw errorePy("ValueError", `Exceeds the limit (${LIMITE_CIFRE} digits) for integer string conversion; use sys.set_int_max_str_digits() to increase the limit`);
  }
  return (v < 0n ? "-" : "") + s;
}

/** Come int.bit_length(). */
export function lunghezzaBit(v) {
  const a = v < 0n ? -v : v;
  return a === 0n ? 0 : a.toString(2).length;
}

/** Come int.to_bytes(n, ordine): `ordine` è "big" o "little". */
export function interoInByte(valore, n, ordine = "big") {
  let v = BigInt(valore);
  if (v < 0n) throw errorePy("OverflowError", "can't convert negative int to unsigned");
  const out = new Uint8Array(n);
  for (let k = n - 1; k >= 0; k--) {
    out[k] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== 0n) throw errorePy("OverflowError", "int too big to convert");
  return ordine === "big" ? out : out.reverse();
}

/** Come int.from_bytes(dati, ordine); restituisce un BigInt. */
export function interoDaByte(dati, ordine = "big") {
  const b = ordine === "big" ? Array.from(dati) : Array.from(dati).reverse();
  let v = 0n;
  for (const x of b) v = (v << 8n) | BigInt(x);
  return v;
}

// ---------------- byte ⇄ esadecimale ----------------

/** Come bytes.hex(sep): cifre minuscole, `sep` tra un byte e l'altro. */
export function hexPy(dati, sep = "") {
  return Array.from(dati, (b) => b.toString(16).padStart(2, "0")).join(sep);
}

/** Come bytes.fromhex(testo): coppie di cifre esadecimali, spazi ASCII ammessi tra una coppia e l'altra. */
export function fromhexPy(testo) {
  const c = Array.from(testo, (x) => x.codePointAt(0));
  const errore = (pos) => errorePy("ValueError", `non-hexadecimal number found in fromhex() arg at position ${pos}`);
  const primoNonAscii = c.findIndex((x) => x >= 128);
  if (primoNonAscii >= 0) throw errore(primoNonAscii);
  const spazio = (x) => x === 32 || (x >= 9 && x <= 13);
  const valore = (x) => (x >= 48 && x <= 57 ? x - 48 : x >= 65 && x <= 70 ? x - 55 : x >= 97 && x <= 102 ? x - 87 : 99);
  const out = [];
  let i = 0;
  while (i < c.length) {
    if (spazio(c[i])) {
      do i++;
      while (i < c.length && spazio(c[i]));
      if (i >= c.length) break;
    }
    const alto = valore(c[i]);
    if (alto >= 16) throw errore(i);
    i++;
    const basso = i < c.length ? valore(c[i]) : 99;
    if (basso >= 16) throw errore(i);
    i++;
    out.push(alto * 16 + basso);
  }
  return Uint8Array.from(out);
}

// ---------------- format() e round() dei numeri decimali ----------------

// Il valore esatto di un double come intero / 10^k (ogni double finito è un numero decimale finito).
function esatto(a) {
  const d = new DataView(new ArrayBuffer(8));
  d.setFloat64(0, a);
  const alto = d.getUint32(0);
  const espBin = (alto >>> 20) & 0x7ff;
  let mant = (BigInt(alto & 0xfffff) << 32n) | BigInt(d.getUint32(4));
  let e = -1074;
  if (espBin !== 0) {
    mant |= 1n << 52n;
    e = espBin - 1075;
  }
  if (e >= 0) return { n: mant << BigInt(e), k: 0 };
  return { n: mant * 5n ** BigInt(-e), k: -e };
}

// Divide per 10^togli arrotondando al pari, come fa Python (sul valore esatto, non su quello scritto).
function arrotondaPari(n, togli) {
  if (togli <= 0) return n * 10n ** BigInt(-togli);
  const p = 10n ** BigInt(togli);
  let q = n / p;
  const doppio = 2n * (n % p);
  if (doppio > p || (doppio === p && q % 2n === 1n)) q += 1n;
  return q;
}

// `p` cifre significative di a > 0: {cifre, esp} con a ≈ c.ccc × 10^esp.
function significative(a, p) {
  if (a === 0) return { cifre: "0".repeat(p), esp: 0 };
  const { n, k } = esatto(a);
  const lung = n.toString().length;
  let esp = lung - 1 - k;
  let q = arrotondaPari(n, lung - p);
  if (q.toString().length > p) {
    q /= 10n;
    esp += 1;
  }
  return { cifre: q.toString(), esp };
}

function fisso(a, decimali) {
  const { n, k } = esatto(a);
  const s = arrotondaPari(n, k - decimali).toString().padStart(decimali + 1, "0");
  return decimali > 0 ? s.slice(0, -decimali) + "." + s.slice(-decimali) : s;
}

function esponente(esp) {
  return "e" + (esp < 0 ? "-" : "+") + String(Math.abs(esp)).padStart(2, "0");
}

/** Come format(x, spec) di Python per un numero decimale; `spec` è "g", ".3g", ".1f", ".2e" e simili. */
export function formatPy(x, spec) {
  const m = /^(?:\.(\d+))?([efg])$/.exec(spec);
  if (!m) throw new Error(`formato non gestito: ${spec}`);
  const tipo = m[2];
  const prec = m[1] === undefined ? 6 : Number(m[1]);
  x = Number(x);
  if (Number.isNaN(x)) return "nan";
  const segno = x < 0 || Object.is(x, -0) ? "-" : "";
  const a = Math.abs(x);
  if (a === Infinity) return segno + "inf";
  if (tipo === "f") return segno + fisso(a, prec);
  if (tipo === "e") {
    const { cifre, esp } = significative(a, prec + 1);
    return segno + cifre[0] + (prec > 0 ? "." + cifre.slice(1) : "") + esponente(esp);
  }
  const p = prec === 0 ? 1 : prec;
  const { cifre, esp } = significative(a, p);
  if (esp >= -4 && esp < p) {
    const intera = esp >= 0 ? cifre.slice(0, esp + 1) : "0";
    const frazione = (esp >= 0 ? cifre.slice(esp + 1) : "0".repeat(-esp - 1) + cifre).replace(/0+$/, "");
    return segno + intera + (frazione ? "." + frazione : "");
  }
  const resto = cifre.slice(1).replace(/0+$/, "");
  return segno + cifre[0] + (resto ? "." + resto : "") + esponente(esp);
}

/** Come format(n, spec) di Python per un intero: "010X", "02X", "05d", "08b", "d"... (`n` Number o BigInt). */
export function formatIntPy(n, spec) {
  const m = /^(0?)(\d*)([dxXb])$/.exec(spec);
  if (!m) throw new Error(`formato non gestito: ${spec}`);
  let v = BigInt(n);
  const segno = v < 0n ? "-" : "";
  if (v < 0n) v = -v;
  let s = v.toString({ d: 10, x: 16, X: 16, b: 2 }[m[3]]);
  if (m[3] === "X") s = s.toUpperCase();
  const larghezza = m[2] ? Number(m[2]) : 0;
  if (m[1]) return segno + s.padStart(larghezza - segno.length, "0");
  return (segno + s).padStart(larghezza, " ");
}

/** Come round(x, cifre) di Python per un numero decimale (cifre >= 0): arrotondamento al pari sul valore esatto. */
export function roundPy(x, cifre) {
  if (!Number.isFinite(x) || x === 0) return x;
  const { n, k } = esatto(Math.abs(x));
  const v = Number(`${arrotondaPari(n, k - cifre)}e-${cifre}`);
  return x < 0 ? -v : v;
}

/** Come round(x) di Python: l'intero più vicino, al pari se x è a metà. */
export function roundInteroPy(x) {
  if (Number.isNaN(x)) throw errorePy("ValueError", "cannot convert float NaN to integer");
  if (!Number.isFinite(x)) throw errorePy("OverflowError", "cannot convert float infinity to integer");
  const a = Math.abs(x);
  const f = Math.floor(a);
  const d = a - f;
  const r = d > 0.5 || (d === 0.5 && f % 2 === 1) ? f + 1 : f;
  return x < 0 ? -r : r;
}

/** Come a / b tra numeri decimali in Python: dividere per zero è un errore (ZeroDivisionError), non Infinity. */
export function dividiPy(a, b) {
  if (b === 0) throw errorePy("ZeroDivisionError", "float division by zero");
  return a / b;
}

/** Come math.floor(x) di Python. */
export function floorPy(x) {
  if (Number.isNaN(x)) throw errorePy("ValueError", "cannot convert float NaN to integer");
  if (!Number.isFinite(x)) throw errorePy("OverflowError", "cannot convert float infinity to integer");
  return Math.floor(x);
}

// ---------------- testo ⇄ byte ----------------

const CODIFICATORE = new TextEncoder();
// ignoreBOM: Python, con "utf-8", tiene il carattere BOM iniziale.
const DECODIFICATORE = new TextDecoder("utf-8", { ignoreBOM: true });

/** Come testo.encode("utf-8"): i surrogati isolati danno UnicodeEncodeError come in Python. */
export function codificaUtf8(testo) {
  const cp = Array.from(testo, (c) => c.codePointAt(0));
  const surrogato = (x) => x >= 0xd800 && x <= 0xdfff;
  const inizio = cp.findIndex(surrogato);
  if (inizio >= 0) {
    let fine = inizio + 1;
    while (fine < cp.length && surrogato(cp[fine])) fine++;
    const dove =
      fine - inizio === 1
        ? `character '\\u${cp[inizio].toString(16).padStart(4, "0")}' in position ${inizio}`
        : `characters in position ${inizio}-${fine - 1}`;
    throw errorePy("UnicodeEncodeError", `'utf-8' codec can't encode ${dove}: surrogates not allowed`);
  }
  return CODIFICATORE.encode(testo);
}

/** Come dati.decode("utf-8", "replace"): ogni sequenza non valida diventa «�». */
export function decodificaUtf8(dati) {
  return DECODIFICATORE.decode(Uint8Array.from(dati));
}

/** Come dati.decode("utf-16", "replace") di Python su un processore little-endian (BOM iniziale facoltativo). */
export function decodificaUtf16(dati) {
  const b = Uint8Array.from(dati);
  const e = b.length;
  let q = 0;
  let le = true;
  if (e >= 2) {
    const bom = (b[1] << 8) | b[0];
    if (bom === 0xfeff) q = 2;
    else if (bom === 0xfffe) {
      q = 2;
      le = false;
    }
  }
  const unita = (k) => (le ? b[k] | (b[k + 1] << 8) : (b[k] << 8) | b[k + 1]);
  let out = "";
  while (q < e) {
    if (e - q < 2) {
      out += "�"; // byte finale spaiato
      break;
    }
    const ch = unita(q);
    q += 2;
    if (ch < 0xd800 || ch > 0xdfff) out += String.fromCharCode(ch);
    else if (ch >= 0xdc00) out += "�"; // seconda metà senza la prima
    else if (e - q < 2) {
      out += "�"; // prima metà alla fine dei dati
      break;
    } else {
      const ch2 = unita(q);
      if (ch2 < 0xdc00 || ch2 > 0xdfff) out += "�"; // prima metà senza la seconda: si rilegge ch2
      else {
        q += 2;
        out += String.fromCharCode(ch, ch2);
      }
    }
  }
  return out;
}

/** Come testo.encode("ascii", "replace"): ogni carattere non ASCII diventa «?». */
export function codificaAscii(testo) {
  return Uint8Array.from(Array.from(testo, (c) => (c.codePointAt(0) < 128 ? c.codePointAt(0) : 0x3f)));
}

/** Come dati.decode("ascii", "replace"): ogni byte oltre 127 diventa «�». */
export function decodificaAscii(dati) {
  return Array.from(dati, (b) => (b < 128 ? String.fromCharCode(b) : "�")).join("");
}

// ---------------- Base64 ----------------

const ALFABETO_B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Come base64.b64encode(dati).decode(). */
export function codificaBase64(dati) {
  const b = Uint8Array.from(dati);
  let out = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += ALFABETO_B64[(n >> 18) & 63] + ALFABETO_B64[(n >> 12) & 63];
    out += i + 1 < b.length ? ALFABETO_B64[(n >> 6) & 63] : "=";
    out += i + 2 < b.length ? ALFABETO_B64[n & 63] : "=";
  }
  return out;
}

/** Come base64.b64decode(testo, validate=True): controllo rigido di caratteri e riempimento («=»). */
export function decodificaBase64(testo) {
  if (!isasciiPy(testo)) throw errorePy("ValueError", "string argument should contain only ASCII characters");
  const errore = (msg) => errorePy("binascii.Error", msg);
  const out = [];
  if (testo.length > 0 && testo[0] === "=") throw errore("Leading padding not allowed");
  let quad = 0;
  let sinistra = 0;
  let riempimento = 0;
  let iniziato = false;
  const datiFinora = () => Math.floor(out.length / 3) * 4 + 1;
  for (let i = 0; i < testo.length; i++) {
    const c = testo[i];
    if (c === "=") {
      iniziato = true;
      if (quad === 0) throw errore("Excess padding not allowed");
      if (quad === 1) throw errore(`Invalid base64-encoded string: number of data characters (${datiFinora()}) cannot be 1 more than a multiple of 4`);
      if (quad + ++riempimento >= 4) {
        if (i + 1 < testo.length) {
          const dopo = testo[i + 1];
          if (dopo === "=") throw errore("Excess padding not allowed");
          throw errore(ALFABETO_B64.includes(dopo) ? "Excess data after padding" : "Only base64 data is allowed");
        }
        return Uint8Array.from(out);
      }
      continue;
    }
    const v = ALFABETO_B64.indexOf(c);
    if (v < 0) throw errore("Only base64 data is allowed");
    if (iniziato) throw errore("Discontinuous padding not allowed");
    riempimento = 0;
    if (quad === 0) sinistra = v;
    else if (quad === 1) {
      out.push(((sinistra << 2) | (v >> 4)) & 0xff);
      sinistra = v & 0x0f;
    } else if (quad === 2) {
      out.push(((sinistra << 4) | (v >> 2)) & 0xff);
      sinistra = v & 0x03;
    } else out.push(((sinistra << 6) | v) & 0xff);
    quad = (quad + 1) % 4;
  }
  if (quad === 1) throw errore(`Invalid base64-encoded string: number of data characters (${datiFinora()}) cannot be 1 more than a multiple of 4`);
  if (quad !== 0) throw errore("Incorrect padding");
  return Uint8Array.from(out);
}

// ---------------- HTML e date ----------------

/** Come html.escape(testo) di Python (anche gli apici). */
export function escapeHtml(testo) {
  return testo.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
}

/** Come time.strftime(formato) con %Y %m %d %H %M %S, sull'ora locale di `data` (un Date). */
export function formattaData(formato, data) {
  const due = (n) => String(n).padStart(2, "0");
  const campi = { Y: String(data.getFullYear()), m: due(data.getMonth() + 1), d: due(data.getDate()), H: due(data.getHours()), M: due(data.getMinutes()), S: due(data.getSeconds()), "%": "%" };
  return formato.replace(/%([YmdHMS%])/g, (_, k) => campi[k]);
}
