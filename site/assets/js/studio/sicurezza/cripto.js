// Polpo Studio — sicurezza: primitive crittografiche.
// Porta di studio/polpo_studio/security/crypto.py: AES-256-GCM, scrypt, HKDF, HMAC, SHA-256, chiave di recupero.
//
// Nessun algoritmo fatto in casa: AES-GCM, HKDF, HMAC e SHA-256 vengono da WebCrypto (`crypto.subtle`);
// scrypt, che WebCrypto non offre, dalla copia verificata di @noble/hashes in ../../terze-parti/.
// Tutto è asincrono: le derivazioni scrypt durano più di mezzo secondo e non devono bloccare la pagina.

import { scryptAsync } from "../../terze-parti/noble-hashes-2.4.0/scrypt.js";
import {
  ALFABETO_B32,
  ErroreValore,
  casuali,
  daBase32,
  esadecimale,
  inBase32,
  lunghezzaPython,
  unisci,
  utf8,
} from "./formati.js";

export const KDF_N = 2 ** 17; // ~128 MB di memoria: rende costoso provare frasi a caso
export const KDF_R = 8;
export const KDF_P = 1;
export const NONCE = 12;
const ETICHETTA = 16; // byte dell'etichetta di autenticazione di AES-GCM

/** Dati alterati, chiave sbagliata o file danneggiato (IntegrityError in Python). */
export class ErroreIntegrita extends Error {
  constructor(messaggio) {
    super(messaggio);
    this.name = "ErroreIntegrita";
  }
}

function sottile() {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("WebCrypto non disponibile: la pagina deve essere aperta in un contesto sicuro");
  return s;
}

// ---------------- chiavi WebCrypto ----------------

/** Chiave AES-GCM da byte grezzi (16, 24 o 32 byte) oppure una CryptoKey già pronta. */
export async function chiaveAes(chiave) {
  if (chiave instanceof CryptoKey) return chiave;
  if (!(chiave instanceof Uint8Array) || ![16, 24, 32].includes(chiave.length)) {
    throw new ErroreValore("la chiave AES-GCM deve avere 128, 192 o 256 bit");
  }
  return sottile().importKey("raw", chiave, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Chiave HMAC-SHA256 da byte grezzi oppure una CryptoKey già pronta. */
export async function chiaveHmac(chiave) {
  if (chiave instanceof CryptoKey) return chiave;
  return sottile().importKey("raw", chiave, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

// ---------------- derivazioni ----------------

/**
 * scrypt con uscita di 32 byte, come `crypto.derive` (N = 2^17, r = 8, p = 1 se non indicati).
 * `progresso(frazione)` viene chiamata durante il calcolo (da 0 a 1), utile per una barra di avanzamento.
 */
export async function deriva(segreto, sale, n = KDF_N, r = KDF_R, p = KDF_P, { progresso } = {}) {
  if (!Number.isSafeInteger(n) || n < 2 || (n & (n - 1)) !== 0 || !Number.isSafeInteger(r) || r < 1 || !Number.isSafeInteger(p) || p < 1) {
    throw new ErroreValore("parametri scrypt non validi");
  }
  return scryptAsync(segreto, sale, { N: n, r, p, dkLen: 32, maxmem: 128 * r * (n + p + 1), onProgress: progresso });
}

/** HKDF-SHA256 senza sale, 32 byte, `info` in UTF-8 (come `crypto.hkdf`). */
export async function hkdf(chiave, info) {
  const k = await sottile().importKey("raw", chiave, "HKDF", false, ["deriveBits"]);
  const bit = await sottile().deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8(info) }, k, 256);
  return new Uint8Array(bit);
}

// ---------------- cifratura ----------------

/**
 * AES-256-GCM: restituisce nonce (12 byte) ‖ testo cifrato ‖ etichetta (16 byte), come `crypto.seal`.
 * `aad` sono i dati aggiuntivi autenticati (Uint8Array).
 */
export async function sigilla(chiave, testo, aad) {
  const k = await chiaveAes(chiave);
  const nonce = casuali(NONCE);
  const cifrato = await sottile().encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 }, k, testo);
  return unisci(nonce, new Uint8Array(cifrato));
}

/** Il contrario di `sigilla`; dati alterati o chiave sbagliata → ErroreIntegrita (come `crypto.unseal`). */
export async function dissigilla(chiave, blob, aad) {
  if (blob.length < NONCE + ETICHETTA) throw new ErroreIntegrita("dati troppo corti");
  const k = await chiaveAes(chiave);
  try {
    const chiaro = await sottile().decrypt({ name: "AES-GCM", iv: blob.subarray(0, NONCE), additionalData: aad, tagLength: 128 }, k, blob.subarray(NONCE));
    return new Uint8Array(chiaro);
  } catch (e) {
    if (e?.name === "OperationError") throw new ErroreIntegrita("autenticazione fallita");
    throw e;
  }
}

// ---------------- impronte ----------------

/** HMAC-SHA256 in esadecimale minuscolo (come `crypto.mac`). */
export async function mac(chiave, dati) {
  const firma = await sottile().sign("HMAC", await chiaveHmac(chiave), dati);
  return esadecimale(new Uint8Array(firma));
}

/** Confronto a tempo costante di due testi (come `hmac.compare_digest`). */
export function ugualiCostante(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diversi = 0;
  for (let i = 0; i < a.length; i++) diversi |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diversi === 0;
}

/** Vero se `atteso` è l'HMAC di `dati` (come `crypto.mac_ok`). */
export async function macValido(chiave, dati, atteso) {
  return ugualiCostante(await mac(chiave, dati), atteso);
}

/** SHA-256 in esadecimale minuscolo (come `crypto.sha256`). */
export async function sha256(dati) {
  return esadecimale(new Uint8Array(await sottile().digest("SHA-256", dati)));
}

// ---------------- chiave di recupero ----------------

/** 160 bit casuali in 8 gruppi da 4 caratteri (alfabeto base32, senza 0/1/8/9). */
export function nuovaChiaveRecupero() {
  return inBase32(casuali(20)).match(/.{4}/g).join("-");
}

/** Accetta minuscole, spazi e trattini; restituisce i 20 byte oppure `null`. */
export function normalizzaChiaveRecupero(testo) {
  if (typeof testo !== "string") return null;
  let s = "";
  for (const ch of testo.toUpperCase()) if (!" -\t\n".includes(ch)) s += ch;
  s = s.replaceAll("0", "O").replaceAll("1", "I").replaceAll("8", "B"); // errori di trascrizione comuni
  if (lunghezzaPython(s) !== 32 || [...s].some((ch) => !ALFABETO_B32.includes(ch))) return null;
  return daBase32(s);
}

// ---------------- frase di accesso ----------------

const FRASI_COMUNI = new Set(["password1234", "passwordpassword", "123456789012", "qwertyuiopas"]);

/** Spiegazioni dei problemi di `problemiFrase`, da mostrare all'utente. */
export const SUGGERIMENTI_FRASE = Object.freeze({
  short: "almeno 12 caratteri",
  repetitive: "troppi caratteri ripetuti",
  common: "è una frase troppo comune",
});

/** Controlli semplici e onesti sulla frase di accesso: elenco di codici ("short", "repetitive", "common"). */
export function problemiFrase(testo) {
  const caratteri = [...testo];
  const problemi = [];
  if (caratteri.length < 12) problemi.push("short");
  if (new Set(caratteri).size < 6) problemi.push("repetitive");
  if (FRASI_COMUNI.has(testo.toLowerCase())) problemi.push("common");
  return problemi;
}
