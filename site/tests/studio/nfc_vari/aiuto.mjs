// Strumenti comuni alle prove «nfc_vari»: lettura dei casi generati da Python e confronto dei risultati.
// I casi sono in site/tests/studio/casi/nfc_vari/*.json (vedi genera_nfc_vari.py per le convenzioni).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hexPy } from "../../../assets/js/studio/strumenti/convertitore.js";

const CARTELLA = new URL("../casi/nfc_vari/", import.meta.url);

/** I casi di un file (es. "ndef"). */
export function casi(nome) {
  return JSON.parse(readFileSync(new URL(`${nome}.json`, CARTELLA), "utf8"));
}

/** Ora fissa usata dal generatore: 22/11/2026 09:05:07, ora locale. */
export const ORA = new Date(2026, 10, 22, 9, 5, 7);

/** Decodifica un valore scritto dal generatore: {cp: [...]} → testo, {float: "inf"} → numero, {int: "..."} → BigInt. */
export function D(x) {
  if (x && typeof x === "object" && !Array.isArray(x)) {
    if ("cp" in x) return String.fromCodePoint(...x.cp);
    if ("float" in x) return { inf: Infinity, "-inf": -Infinity, nan: NaN }[x.float];
    if ("int" in x) return BigInt(x.int);
  }
  return x;
}

/** Testo da pezzi ripetuti ([[testo, volte], ...]) o testo semplice. */
export function daPezzi(x) {
  return Array.isArray(x) ? x.map(([t, n]) => t.repeat(n)).join("") : D(x);
}

/** Byte da esadecimale. */
export function B(h) {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
}

/** Valore JavaScript → forma dei file JSON (byte in esadecimale, numeri non finiti come {float}). */
export function J(x) {
  if (x instanceof Uint8Array) return hexPy(x);
  if (typeof x === "number" && !Number.isFinite(x)) return { float: Number.isNaN(x) ? "nan" : x > 0 ? "inf" : "-inf" };
  if (typeof x === "bigint") return Math.abs(Number(x)) < 2 ** 53 ? Number(x) : { int: x.toString() };
  if (Array.isArray(x)) return x.map(J);
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, J(v)]));
  return x;
}

/** Come esito() del generatore: {ok: risultato} oppure {errore: {tipo, msg}}. Gli errori senza `tipo` sono difetti: si rilanciano. */
export function esito(f, conv = J) {
  let r;
  try {
    r = f();
  } catch (e) {
    if (!e.tipo) throw e;
    return { errore: { tipo: e.tipo, msg: e.message } };
  }
  return { ok: conv(r) };
}

/**
 * Confronta tutti i casi: `calcola(caso)` dà il risultato JavaScript, `atteso(caso)` quello di Python.
 * Riporta i primi casi diversi (con l'ingresso) e fallisce se ce n'è almeno uno. Restituisce quanti casi ha controllato.
 */
export function confronta(elenco, calcola, atteso = (c) => c.r) {
  const diversi = [];
  for (const [i, c] of elenco.entries()) {
    let r;
    try {
      r = calcola(c);
      assert.deepStrictEqual(r, atteso(c));
    } catch (e) {
      diversi.push(`#${i} ${JSON.stringify(c).slice(0, 400)}\n  ${String(e.message).split("\n").slice(0, 12).join("\n  ")}`);
    }
  }
  if (diversi.length) assert.fail(`${diversi.length} casi su ${elenco.length} diversi da Python:\n` + diversi.slice(0, 8).join("\n"));
  assert.ok(elenco.length > 0, "nessun caso");
  return elenco.length;
}
