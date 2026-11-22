// Polpo Studio — formato a righe «chiave: valore» dei file .ir e .sub (stesse regole del firmware).
// Porting di studio/polpo_studio/protocols/flipper_format.py: deve dare gli stessi risultati del
// codice Python, e lo verificano le prove in site/tests/studio/radio_ir/.
//
// Nella seconda parte ci sono le piccole funzioni che imitano Python (spazi e cifre Unicode, int(),
// float(), formati dei numeri, repr): servono agli altri moduli dei protocolli per dare gli stessi
// risultati anche con testi strani. Gli interi sono Number finché sono sicuri (|n| ≤ 2^53 − 1),
// altrimenti BigInt, così restano esatti come gli int di Python.

// ---------------- errori ----------------

/** Errore che corrisponde a un'eccezione Python: `tipo` ne riporta il nome (es. "FormatError"). */
export class ErrorePy extends Error {
  static tipo = "Exception";
  constructor(messaggio = "", tipo = undefined) {
    super(messaggio);
    this.name = new.target.name;
    this.tipo = tipo ?? new.target.tipo;
  }
}
/** ValueError di Python. */
export class ErroreValore extends ErrorePy {
  static tipo = "ValueError";
}
/** FormatError: file illeggibile. Come in Python è anche un ErroreValore. */
export class ErroreFormato extends ErroreValore {
  static tipo = "FormatError";
}
/** OverflowError di Python (numero troppo grande, o negativo dove non si può). */
export class ErroreOverflow extends ErrorePy {
  static tipo = "OverflowError";
}
/** TypeError di Python (valore del tipo sbagliato). */
export class ErroreTipo extends ErrorePy {
  static tipo = "TypeError";
}
/** KeyError di Python (chiave mancante in un dizionario). */
export class ErroreChiave extends ErrorePy {
  static tipo = "KeyError";
}

// ---------------- formato ----------------

/** Documento letto: tipo di file, versione e righe `[chiave, valore, numero di riga]`. */
export class DocFf {
  constructor(tipoFile = "", versione = 0, righe = []) {
    this.tipoFile = tipoFile;
    this.versione = versione;
    this.righe = righe;
  }
}

/** Legge il testo di un file .ir o .sub. Lancia ErroreFormato se manca l'intestazione o una riga è rotta. */
export function leggiFf(testo) {
  const doc = new DocFf();
  let haTipo = false;
  let haVersione = false;
  const righe = testo.split("\n");
  for (let i = 0; i < righe.length; i++) {
    const n = i + 1;
    const r = togliSpazi(righe[i]);
    if (!r || r.startsWith("#")) continue;
    const dp = r.indexOf(":");
    if (dp <= 0) throw new ErroreFormato(`riga ${n}: manca ':'`);
    const chiave = togliSpazi(r.slice(0, dp));
    const valore = togliSpazi(r.slice(dp + 1));
    if (!haTipo) {
      if (chiave !== "Filetype") throw new ErroreFormato("manca l'intestazione Filetype");
      doc.tipoFile = valore;
      haTipo = true;
    } else if (!haVersione) {
      if (chiave !== "Version" || !soloCifre(valore)) throw new ErroreFormato("manca o non valida l'intestazione Version");
      doc.versione = interoDaTesto(valore);
      haVersione = true;
    } else {
      doc.righe.push([chiave, valore, n]);
    }
  }
  if (!(haTipo && haVersione)) throw new ErroreFormato("file vuoto o senza intestazione");
  return doc;
}

/** Una riga «chiave: valore» con il ritorno a capo. */
export function riga(chiave, valore) {
  return `${testoPy(chiave)}: ${testoPy(valore)}\n`;
}

/** Le due righe d'intestazione (Filetype e Version). */
export function intestazione(tipoFile, versione = 1) {
  return riga("Filetype", tipoFile) + riga("Version", versione);
}

/** Byte scritti in esadecimale ("07 00 00 00", spazi liberi). `null` se il testo non è valido. */
export function leggiByteEsa(testo) {
  const s = dividi(testo).join("");
  if (!/^[0-9A-Fa-f]*$/.test(s) || s.length % 2) return null;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
}

/** Byte in esadecimale maiuscolo separati da spazi ("07 00 00 00"). */
export function byteEsa(dati) {
  return Array.from(dati, (b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
}

/** Come `int.to_bytes(n, ordine)` di Python: `ordine` è "little" o "big". */
export function inByte(valore, n, ordine) {
  if (!["number", "bigint", "boolean"].includes(typeof valore) || (typeof valore === "number" && !Number.isInteger(valore))) {
    throw new ErrorePy(`'${nomeTipoPy(valore)}' object has no attribute 'to_bytes'`, "AttributeError");
  }
  let v = BigInt(valore);
  if (v < 0n) throw new ErroreOverflow("can't convert negative int to unsigned");
  if (v >> BigInt(8 * n)) throw new ErroreOverflow("int too big to convert");
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    out[ordine === "little" ? i : n - 1 - i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** Come `int.from_bytes(dati, ordine)` di Python. */
export function daByte(dati, ordine) {
  let v = 0n;
  const n = dati.length;
  for (let i = 0; i < n; i++) v = (v << 8n) | BigInt(dati[ordine === "little" ? n - 1 - i : i]);
  return normalizzaIntero(v);
}

/**
 * `dati.decode("utf-8", "replace")` di Python: i byte non validi diventano U+FFFD e, a differenza
 * del TextDecoder predefinito, il BOM iniziale resta nel testo (così un file con BOM dà lo stesso errore).
 */
export function testoDaByte(dati) {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(dati);
}

/** `testo.encode()` di Python (UTF-8): lancia come Python se ci sono surrogati spaiati. */
export function byteDaTesto(testo) {
  const c = Array.from(testo);
  const surrogato = (x) => x.length === 1 && x.charCodeAt(0) >= 0xd800 && x.charCodeAt(0) <= 0xdfff;
  const i = c.findIndex(surrogato);
  if (i >= 0) {
    let j = i + 1;
    while (j < c.length && surrogato(c[j])) j++;
    const dove = j === i + 1 ? `character '\\u${c[i].charCodeAt(0).toString(16)}' in position ${i}` : `characters in position ${i}-${j - 1}`;
    throw new ErrorePy(`'utf-8' codec can't encode ${dove}: surrogates not allowed`, "UnicodeEncodeError");
  }
  return new TextEncoder().encode(testo);
}

// ---------------- come Python: spazi e cifre ----------------

// I caratteri per cui `str.isspace()` è vero: sono quelli che tolgono `strip()` e `split()`.
const SPAZI = new Set([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002,
  0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
]);

/** Vero se il carattere di codice `cp` è uno spazio per Python. */
export function spazioPy(cp) {
  return SPAZI.has(cp);
}

/** `s.strip()` di Python. */
export function togliSpazi(s) {
  let i = 0;
  let j = s.length;
  while (i < j && SPAZI.has(s.charCodeAt(i))) i++;
  while (j > i && SPAZI.has(s.charCodeAt(j - 1))) j--;
  return s.slice(i, j);
}

/** `s.split()` di Python: le parole separate da spazi. */
export function dividi(s) {
  const out = [];
  let inizio = -1;
  for (let i = 0; i < s.length; i++) {
    if (SPAZI.has(s.charCodeAt(i))) {
      if (inizio >= 0) out.push(s.slice(inizio, i));
      inizio = -1;
    } else if (inizio < 0) {
      inizio = i;
    }
  }
  if (inizio >= 0) out.push(s.slice(inizio));
  return out;
}

// Cifre decimali non ASCII (categoria Nd di Unicode 15, come Python 3.12 e 3.13): primo e ultimo
// carattere di ogni serie. Ogni serie è fatta di gruppi completi da 0 a 9: il valore è (cp − primo) % 10.
const DECIMALI = [
  0x660, 0x669, 0x6f0, 0x6f9, 0x7c0, 0x7c9, 0x966, 0x96f, 0x9e6, 0x9ef, 0xa66, 0xa6f, 0xae6, 0xaef,
  0xb66, 0xb6f, 0xbe6, 0xbef, 0xc66, 0xc6f, 0xce6, 0xcef, 0xd66, 0xd6f, 0xde6, 0xdef, 0xe50, 0xe59,
  0xed0, 0xed9, 0xf20, 0xf29, 0x1040, 0x1049, 0x1090, 0x1099, 0x17e0, 0x17e9, 0x1810, 0x1819, 0x1946, 0x194f,
  0x19d0, 0x19d9, 0x1a80, 0x1a89, 0x1a90, 0x1a99, 0x1b50, 0x1b59, 0x1bb0, 0x1bb9, 0x1c40, 0x1c49,
  0x1c50, 0x1c59, 0xa620, 0xa629, 0xa8d0, 0xa8d9, 0xa900, 0xa909, 0xa9d0, 0xa9d9, 0xa9f0, 0xa9f9,
  0xaa50, 0xaa59, 0xabf0, 0xabf9, 0xff10, 0xff19, 0x104a0, 0x104a9, 0x10d30, 0x10d39, 0x11066, 0x1106f,
  0x110f0, 0x110f9, 0x11136, 0x1113f, 0x111d0, 0x111d9, 0x112f0, 0x112f9, 0x11450, 0x11459, 0x114d0, 0x114d9,
  0x11650, 0x11659, 0x116c0, 0x116c9, 0x11730, 0x11739, 0x118e0, 0x118e9, 0x11950, 0x11959, 0x11c50, 0x11c59,
  0x11d50, 0x11d59, 0x11da0, 0x11da9, 0x11f50, 0x11f59, 0x16a60, 0x16a69, 0x16ac0, 0x16ac9, 0x16b50, 0x16b59,
  0x1d7ce, 0x1d7ff, 0x1e140, 0x1e149, 0x1e2f0, 0x1e2f9, 0x1e4f0, 0x1e4f9, 0x1e950, 0x1e959, 0x1fbf0, 0x1fbf9,
];
// Gli altri caratteri che `str.isdigit()` considera cifre (apici, pedici, cifre cerchiate…):
// `int()` però non li accetta.
const ALTRE_CIFRE = [
  0xb2, 0xb3, 0xb9, 0xb9, 0x1369, 0x1371, 0x19da, 0x19da, 0x2070, 0x2070, 0x2074, 0x2079, 0x2080, 0x2089,
  0x2460, 0x2468, 0x2474, 0x247c, 0x2488, 0x2490, 0x24ea, 0x24ea, 0x24f5, 0x24fd, 0x24ff, 0x24ff,
  0x2776, 0x277e, 0x2780, 0x2788, 0x278a, 0x2792, 0x10a40, 0x10a43, 0x10e60, 0x10e68, 0x11052, 0x1105a,
  0x1f100, 0x1f10a,
];

/** Indice della serie [primo, ultimo] che contiene `cp`, oppure -1. */
function serie(tabella, cp) {
  let a = 0;
  let b = tabella.length / 2 - 1;
  while (a <= b) {
    const m = (a + b) >> 1;
    if (cp < tabella[2 * m]) b = m - 1;
    else if (cp > tabella[2 * m + 1]) a = m + 1;
    else return 2 * m;
  }
  return -1;
}

/** Valore (0…9) della cifra decimale di codice `cp` (anche non ASCII, come Python), oppure -1. */
export function valoreDecimale(cp) {
  if (cp < 0x80) return cp >= 0x30 && cp <= 0x39 ? cp - 0x30 : -1;
  const i = serie(DECIMALI, cp);
  return i < 0 ? -1 : (cp - DECIMALI[i]) % 10;
}

/** Vero se il carattere di codice `cp` è una cifra per `str.isdigit()` di Python. */
export function cifraPy(cp) {
  return valoreDecimale(cp) >= 0 || serie(ALTRE_CIFRE, cp) >= 0;
}

/** `s.isdigit()` di Python: testo non vuoto fatto solo di cifre. */
export function soloCifre(s) {
  if (!s) return false;
  for (const c of s) if (!cifraPy(c.codePointAt(0))) return false;
  return true;
}

/** I primi `n` caratteri come li conta Python (`s[:n]`). */
export function inizioPy(s, n) {
  return Array.from(s).slice(0, n).join("");
}

// ---------------- come Python: numeri ----------------

const MAX_SICURO = BigInt(Number.MAX_SAFE_INTEGER);

/** Un BigInt come intero "alla Python": Number se è sicuro, altrimenti resta BigInt. */
export function normalizzaIntero(v) {
  return v >= -MAX_SICURO && v <= MAX_SICURO ? Number(v) : v;
}

/** Vero se `x` è un intero (Number intero o BigInt). */
function intero(x) {
  return typeof x === "bigint" || (typeof x === "number" && Number.isInteger(x));
}

const SPAZI_ASCII = " \t\n\v\f\r";

/** Come fa Python prima di leggere un numero: cifre Unicode → ASCII, spazi Unicode → " ". `null` se c'è un carattere estraneo. */
function inAscii(testo) {
  let a = "";
  for (const c of testo) {
    const cp = c.codePointAt(0);
    if (cp < 127) a += c;
    else if (SPAZI.has(cp)) a += " ";
    else {
      const d = valoreDecimale(cp);
      if (d < 0) return null;
      a += String.fromCharCode(0x30 + d);
    }
  }
  return a;
}

function valoreCifra(c) {
  const k = c.charCodeAt(0);
  if (k >= 0x30 && k <= 0x39) return k - 0x30;
  if (k >= 0x61 && k <= 0x7a) return k - 0x61 + 10;
  if (k >= 0x41 && k <= 0x5a) return k - 0x41 + 10;
  return 99;
}

/**
 * `int(testo, base)` di Python per base 10 o 16: spazi ai lati, segno, "0x" in base 16, "_" tra le cifre,
 * cifre Unicode. Lancia ErroreValore con lo stesso messaggio di Python.
 */
export function interoDaTesto(testo, base = 10) {
  const errore = () =>
    new ErroreValore(`invalid literal for int() with base ${base}: ${inizioPy(reprTesto(testo), 200)}`);
  const a = inAscii(testo);
  if (a === null) throw errore();
  const n = a.length;
  let i = 0;
  while (i < n && SPAZI_ASCII.includes(a[i])) i++;
  let negativo = false;
  if (a[i] === "+") i++;
  else if (a[i] === "-") {
    negativo = true;
    i++;
  }
  if (base === 16 && a[i] === "0" && (a[i + 1] === "x" || a[i + 1] === "X")) {
    i += 2;
    if (a[i] === "_") i++;
  }
  if (a[i] === "_") throw errore();
  let cifre = "";
  let prec = "";
  while (i < n && (valoreCifra(a[i]) < base || a[i] === "_")) {
    if (a[i] === "_") {
      if (prec === "_") throw errore();
    } else cifre += a[i];
    prec = a[i];
    i++;
  }
  if (prec === "_" || cifre === "") throw errore();
  while (i < n && SPAZI_ASCII.includes(a[i])) i++;
  if (i !== n) throw errore();
  if (base === 10 && cifre.length > 4300) {
    throw new ErroreValore(
      `Exceeds the limit (4300 digits) for integer string conversion: value has ${cifre.length} digits; use sys.set_int_max_str_digits() to increase the limit`,
    );
  }
  const v = BigInt(base === 16 ? "0x" + cifre : cifre);
  return normalizzaIntero(negativo ? -v : v);
}

/** `float(testo)` di Python (anche "inf", "nan", "_" tra le cifre, cifre Unicode). Lancia ErroreValore. */
export function decimaleDaTesto(testo) {
  const errore = () => new ErroreValore(`could not convert string to float: ${reprTesto(testo)}`);
  let a = inAscii(testo);
  if (a === null || a.includes("\0")) throw errore();
  if (a.includes("_")) {
    let senza = "";
    let prec = "";
    for (const c of a) {
      const cifra = c >= "0" && c <= "9";
      if (c === "_") {
        if (!(prec >= "0" && prec <= "9")) throw errore();
      } else {
        if (prec === "_" && !cifra) throw errore();
        senza += c;
      }
      prec = c;
    }
    if (prec === "_") throw errore();
    a = senza;
  }
  let i = 0;
  let j = a.length;
  while (i < j && SPAZI_ASCII.includes(a[i])) i++;
  while (j > i && SPAZI_ASCII.includes(a[j - 1])) j--;
  const s = a.slice(i, j);
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) return Number(s);
  const m = /^([+-]?)(inf|infinity|nan)$/i.exec(s);
  if (!m) throw errore();
  if (m[2].toLowerCase() === "nan") return NaN;
  return m[1] === "-" ? -Infinity : Infinity;
}

/** Scompone un Number finito e positivo: `x = m · 2^e` con `m` BigInt. */
function scomponi(x) {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const alto = dv.getUint32(0);
  const esp = (alto >>> 20) & 0x7ff;
  const m = (BigInt(alto & 0xfffff) << 32n) | BigInt(dv.getUint32(4));
  return esp === 0 ? [m, -1074] : [m | (1n << 52n), esp - 1075];
}

/** `f"{x:.{cifre}f}"` di Python: arrotonda il valore esatto alla pari (0.0078125 → "0.007812"). */
export function virgolaFissa(x, cifre) {
  if (typeof x === "bigint") {
    const v = Number(x);
    if (!Number.isFinite(v)) throw new ErroreOverflow("int too large to convert to float");
    x = v;
  }
  if (typeof x === "boolean") x = x ? 1 : 0;
  if (Number.isNaN(x)) return "nan";
  const negativo = x < 0 || Object.is(x, -0);
  if (!Number.isFinite(x)) return negativo ? "-inf" : "inf";
  const [m, e] = scomponi(Math.abs(x));
  const p10 = 10n ** BigInt(cifre);
  let q;
  if (e >= 0) q = (m << BigInt(e)) * p10;
  else {
    const num = m * p10;
    const den = 1n << BigInt(-e);
    q = num / den;
    const r2 = (num % den) * 2n;
    if (r2 > den || (r2 === den && q & 1n)) q += 1n;
  }
  let s = q.toString();
  if (cifre > 0) {
    s = s.padStart(cifre + 1, "0");
    s = s.slice(0, s.length - cifre) + "." + s.slice(s.length - cifre);
  }
  return (negativo ? "-" : "") + s;
}

/** `repr(x)` di Python per un numero decimale (float): "0.33", "1e-05", "1e+16", "5.0". */
export function reprDecimale(x) {
  if (Number.isNaN(x)) return "nan";
  if (x === Infinity) return "inf";
  if (x === -Infinity) return "-inf";
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const segno = x < 0 ? "-" : "";
  const [mant, esp] = Math.abs(x).toExponential().split("e");
  const cifre = mant.replace(".", "");
  const punto = Number(esp) + 1; // il valore è 0.<cifre> · 10^punto
  if (punto <= -4 || punto > 16) {
    const e = punto - 1;
    const testa = cifre.length > 1 ? cifre[0] + "." + cifre.slice(1) : cifre;
    return `${segno}${testa}e${e < 0 ? "-" : "+"}${String(Math.abs(e)).padStart(2, "0")}`;
  }
  if (punto <= 0) return `${segno}0.${"0".repeat(-punto)}${cifre}`;
  if (punto >= cifre.length) return `${segno}${cifre}${"0".repeat(punto - cifre.length)}.0`;
  return `${segno}${cifre.slice(0, punto)}.${cifre.slice(punto)}`;
}

// Per Python non sono stampabili le categorie C* (controllo, formato, surrogati, privati, non assegnati) e Z*.
const NON_STAMPABILE = /^[\p{C}\p{Z}]$/u;

/** `repr(s)` di Python per un testo: apici, sequenze \n \x.. \u.. per i caratteri non stampabili. */
export function reprTesto(s) {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = q;
  for (const c of s) {
    const cp = c.codePointAt(0);
    if (c === q || c === "\\") out += "\\" + c;
    else if (c === "\t") out += "\\t";
    else if (c === "\n") out += "\\n";
    else if (c === "\r") out += "\\r";
    else if (cp < 0x20 || cp === 0x7f) out += "\\x" + cp.toString(16).padStart(2, "0");
    else if (cp < 0x7f || !NON_STAMPABILE.test(c)) out += c;
    else if (cp <= 0xff) out += "\\x" + cp.toString(16).padStart(2, "0");
    else if (cp <= 0xffff) out += "\\u" + cp.toString(16).padStart(4, "0");
    else out += "\\U" + cp.toString(16).padStart(8, "0");
  }
  return out + q;
}

/** Nome del tipo Python di un valore JSON ('NoneType', 'bool', 'int', 'float', 'str', 'list', 'dict'). */
export function nomeTipoPy(x) {
  if (x === null || x === undefined) return "NoneType";
  if (typeof x === "boolean") return "bool";
  if (typeof x === "bigint") return "int";
  if (typeof x === "number") return Number.isSafeInteger(x) ? "int" : "float";
  if (typeof x === "string") return "str";
  if (Array.isArray(x)) return "list";
  return "dict";
}

/** `repr(x)` di Python per un valore JSON. I Number interi sicuri valgono come int, gli altri come float. */
export function reprPy(x) {
  switch (nomeTipoPy(x)) {
    case "NoneType":
      return "None";
    case "bool":
      return x ? "True" : "False";
    case "int":
      return BigInt(x).toString();
    case "float":
      return reprDecimale(x);
    case "str":
      return reprTesto(x);
    case "list":
      return "[" + x.map(reprPy).join(", ") + "]";
    default:
      return "{" + Object.entries(x).map(([k, v]) => `${reprTesto(k)}: ${reprPy(v)}`).join(", ") + "}";
  }
}

/** `str(x)` di Python: i testi restano come sono, il resto come `repr`. */
export function testoPy(x) {
  return typeof x === "string" ? x : reprPy(x);
}

/** `bool(x)` di Python: falsi None, False, 0, "", liste e dizionari vuoti (NaN invece è vero). */
export function veroPy(x) {
  if (x === null || x === undefined) return false;
  if (typeof x === "number") return x !== 0;
  if (typeof x === "bigint") return x !== 0n;
  if (typeof x === "string" || Array.isArray(x)) return x.length > 0;
  if (typeof x === "object") return Object.keys(x).length > 0;
  return Boolean(x);
}

/** `int(x)` di Python per un valore JSON (testo, numero, booleano). */
export function interoDa(x) {
  if (typeof x === "boolean") return x ? 1 : 0;
  if (typeof x === "bigint") return normalizzaIntero(x);
  if (typeof x === "number") {
    if (Number.isNaN(x)) throw new ErroreValore("cannot convert float NaN to integer");
    if (!Number.isFinite(x)) throw new ErroreOverflow("cannot convert float infinity to integer");
    return normalizzaIntero(BigInt(Math.trunc(x)));
  }
  if (typeof x === "string") return interoDaTesto(x, 10);
  throw new ErroreTipo(`int() argument must be a string, a bytes-like object or a real number, not '${nomeTipoPy(x)}'`);
}

/** Gli elementi su cui Python itera con `for x in valore` (liste, caratteri di un testo, chiavi). */
export function elementiPy(x) {
  if (Array.isArray(x)) return x;
  if (typeof x === "string") return Array.from(x);
  if (x !== null && typeof x === "object") return Object.keys(x);
  throw new ErroreTipo(`'${nomeTipoPy(x)}' object is not iterable`);
}

/** `d.get(chiave, predefinito)` di Python. */
export function prendi(d, chiave, predefinito = null) {
  return Object.hasOwn(d, chiave) && d[chiave] !== undefined ? d[chiave] : predefinito;
}

/** `d[chiave]` di Python: lancia ErroreChiave se manca. */
export function elemento(d, chiave) {
  if (!Object.hasOwn(d, chiave) || d[chiave] === undefined) throw new ErroreChiave(reprTesto(chiave));
  return d[chiave];
}

/** `abs(x)` per Number e BigInt. */
export function assoluto(x) {
  return x < 0 ? -x : x;
}

/** `x >> n` di Python (anche oltre i 32 bit e per i negativi). */
export function spostaDestra(x, n) {
  if (!intero(x) || !intero(n)) {
    throw new ErroreTipo(`unsupported operand type(s) for >>: '${nomeTipoPy(x)}' and '${nomeTipoPy(n)}'`);
  }
  return normalizzaIntero(BigInt(x) >> BigInt(n));
}

/** Numero di bit di un BigInt positivo. */
function bitDi(v) {
  return v.toString(2).length;
}

/** `a / b` di Python tra interi BigInt (b > 0): risultato arrotondato correttamente al Number più vicino. */
function divisioneEsatta(a, b) {
  if (a === 0n) return 0;
  const negativo = a < 0n;
  if (negativo) a = -a;
  const s = bitDi(a) - bitDi(b) - 55;
  let q;
  let r;
  if (s >= 0) {
    const d = b << BigInt(s);
    q = a / d;
    r = a % d;
  } else {
    const n = a << BigInt(-s);
    q = n / b;
    r = n % b;
  }
  const extra = bitDi(q) - 53;
  const basso = q & ((1n << BigInt(extra)) - 1n);
  const meta = 1n << BigInt(extra - 1);
  let alto = q >> BigInt(extra);
  if (basso > meta || (basso === meta && (r !== 0n || alto & 1n))) alto += 1n;
  const v = Number(alto) * 2 ** (s + extra);
  if (!Number.isFinite(v)) throw new ErroreOverflow("integer division result too large for a float");
  return negativo ? -v : v;
}

/** Numero (anche booleano o BigInt) per le operazioni; lancia ErroreTipo come Python per gli altri tipi. */
function operando(x, y, simbolo) {
  for (const v of [x, y]) {
    if (!["number", "bigint", "boolean"].includes(typeof v)) {
      throw new ErroreTipo(`unsupported operand type(s) for ${simbolo}: '${nomeTipoPy(x)}' and '${nomeTipoPy(y)}'`);
    }
  }
  return [typeof x === "boolean" ? Number(x) : x, typeof y === "boolean" ? Number(y) : y];
}

/** `a / b` di Python: tra interi grandi il risultato è arrotondato correttamente. */
export function divisioneVera(a, b) {
  [a, b] = operando(a, b, "/");
  if (typeof a === "bigint" || typeof b === "bigint") {
    if (intero(a) && intero(b)) {
      let x = BigInt(a);
      let y = BigInt(b);
      if (y === 0n) throw new ErrorePy("division by zero", "ZeroDivisionError");
      if (y < 0n) {
        x = -x;
        y = -y;
      }
      return divisioneEsatta(x, y);
    }
    [a, b] = [a, b].map((v) => {
      if (typeof v !== "bigint") return v;
      const f = Number(v);
      if (!Number.isFinite(f)) throw new ErroreOverflow("int too large to convert to float");
      return f;
    });
  }
  if (b === 0) throw new ErrorePy(intero(a) && intero(b) ? "division by zero" : "float division by zero", "ZeroDivisionError");
  return a / b;
}

/** `a // b` di Python (divisione arrotondata verso il basso), anche con i decimali. */
export function divisioneIntera(a, b) {
  [a, b] = operando(a, b, "//");
  const sicuro = (v) => typeof v === "number" && Number.isSafeInteger(v);
  if (sicuro(a) && sicuro(b)) {
    if (b === 0) throw new ErrorePy("integer division or modulo by zero", "ZeroDivisionError");
    return Math.floor(a / b) || 0; // esatto per gli interi sicuri; niente -0
  }
  if ((typeof a === "bigint" || typeof b === "bigint") && intero(a) && intero(b)) {
    const x = BigInt(a);
    const y = BigInt(b);
    if (y === 0n) throw new ErrorePy("integer division or modulo by zero", "ZeroDivisionError");
    let q = x / y;
    if (x % y !== 0n && x < 0n !== y < 0n) q -= 1n;
    return normalizzaIntero(q);
  }
  // decimali: stesso calcolo di Python (_float_div_mod in floatobject.c)
  a = Number(a);
  b = Number(b);
  if (b === 0) throw new ErrorePy("float floor division by zero", "ZeroDivisionError");
  const resto = a % b;
  let div = (a - resto) / b;
  if (resto && b < 0 !== resto < 0) div -= 1;
  if (div || Number.isNaN(div)) {
    let q = Math.floor(div);
    if (div - q > 0.5) q += 1;
    return q;
  }
  const q = a / b; // zero con il segno del quoziente vero
  return q < 0 || Object.is(q, -0) ? -0 : 0;
}

/** Interi in esadecimale maiuscolo come `f"{v:0{larghezza}X}"` di Python (il segno conta nella larghezza). */
export function esaMaiuscolo(v, larghezza = 0) {
  let x = BigInt(v);
  const negativo = x < 0n;
  if (negativo) x = -x;
  const cifre = x.toString(16).toUpperCase();
  return (negativo ? "-" : "") + cifre.padStart(larghezza - (negativo ? 1 : 0), "0");
}

/** `html.escape(s)` di Python: & < > " ' diventano entità. */
export function escapeHtml(s) {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
}
