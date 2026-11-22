// Polpo Studio — sicurezza: copie di sicurezza `.polpobak`.
// Porta di studio/polpo_studio/security/backup.py: un file creato da Polpo Studio sul computer si ripristina qui,
// e viceversa.
//
// Tutta la cassaforte in un file cifrato con una password a parte (diversa dalla frase della cassaforte), così il
// file si può ripristinare anche su un altro dispositivo. Formato:
//
//   MAGIC "POLPOBAK\x01" (9 byte) | lunghezza intestazione (u32 big endian) | intestazione JSON | nonce + AES-GCM
//
// L'intestazione (in chiaro: formato, data, parametri scrypt) è autenticata come AAD; il contenuto cifrato è il
// JSON {"format": "polpobak", "version": 1, "items": [...]} compresso con zlib.

import * as C from "./cripto.js";
import {
  ErroreValore,
  casuali,
  daBase64,
  daUtf8,
  decomprimi,
  comprimi,
  inBase64,
  interoPython,
  jsonPython,
  lunghezzaPython,
  strPython,
  u32be,
  unisci,
  utf8,
  veroPython,
} from "./formati.js";
import { ErroreCassaforte } from "./cassaforte.js";

export const MAGIC = Uint8Array.from([0x50, 0x4f, 0x4c, 0x50, 0x4f, 0x42, 0x41, 0x4b, 0x01]); // "POLPOBAK\x01"
export const MAX_BACKUP = 512 * 1024 * 1024;
export const ESTENSIONE = ".polpobak";

export class ErroreBackup extends Error {
  constructor(messaggio) {
    super(messaggio);
    this.name = "ErroreBackup";
  }
}

/**
 * Crea il backup di tutta la cassaforte (che deve essere aperta).
 * @returns {Promise<{dati: Uint8Array, quanti: number}>} i byte del file `.polpobak` e il numero di file salvati
 */
export async function esportaBackup(cassaforte, password, { kdfN = C.KDF_N, progresso } = {}) {
  if (lunghezzaPython(password) < 8) throw new ErroreBackup("la password del backup deve avere almeno 8 caratteri");
  const voci = [];
  for (const v of cassaforte.voci()) {
    const dati = await cassaforte.leggi(v.id);
    voci.push({
      category: v.categoria,
      name: v.nome,
      created: v.creato,
      modified: v.modificato,
      origin: v.origine,
      meta: v.meta,
      sha256: v.sha256,
      data: inBase64(dati),
    });
  }
  const contenuto = await comprimi(utf8(jsonPython({ format: "polpobak", version: 1, items: voci }, { soloAscii: false })));
  const sale = casuali(16);
  const intestazione = utf8(
    jsonPython({
      format: "polpobak",
      version: 1,
      created: Date.now() / 1000,
      kdf: { alg: "scrypt", n: kdfN, r: C.KDF_R, p: C.KDF_P, salt: inBase64(sale) },
    }),
  );
  const chiave = await C.deriva(utf8(password), sale, kdfN, C.KDF_R, C.KDF_P, { progresso });
  try {
    const sigillato = await C.sigilla(chiave, contenuto, intestazione);
    return { dati: unisci(MAGIC, u32be(intestazione.length), intestazione, sigillato), quanti: voci.length };
  } finally {
    chiave.fill(0);
  }
}

function separa(dati) {
  if (!(dati instanceof Uint8Array)) throw new TypeError("backup: serve un Uint8Array");
  if (dati.length > MAX_BACKUP) throw new ErroreBackup("file troppo grande");
  if (dati.length < MAGIC.length + 4 || MAGIC.some((b, i) => dati[i] !== b)) throw new ErroreBackup("non è un backup di Polpo Studio");
  const lunghezza = new DataView(dati.buffer, dati.byteOffset + MAGIC.length, 4).getUint32(0, false);
  const inizio = MAGIC.length + 4;
  const intestazione = dati.subarray(inizio, inizio + lunghezza);
  let h;
  try {
    h = JSON.parse(daUtf8(intestazione));
    const k = h.kdf;
    if (h === null || typeof h !== "object" || k === null || typeof k !== "object") throw new ErroreValore("intestazione");
    const n = interoPython(k.n);
    const r = interoPython(k.r);
    const p = interoPython(k.p);
    if (h.format !== "polpobak" || k.alg !== "scrypt" || !(2 ** 10 <= n && n <= 2 ** 20)) throw new ErroreValore("intestazione");
    if ((n & (n - 1)) !== 0 || r < 1 || p < 1) throw new ErroreValore("parametri scrypt");
    const sale = daBase64(k.salt);
    return { intestazione, info: h, n, r, p, sale, sigillato: dati.subarray(inizio + lunghezza) };
  } catch (e) {
    if (e instanceof ErroreValore || e instanceof SyntaxError || e instanceof TypeError) throw new ErroreBackup("intestazione del backup non valida");
    throw e;
  }
}

/**
 * L'intestazione in chiaro di un backup (senza password): `{creato, kdf: {alg, n, r, p}}`.
 * Non garantisce che il file sia integro: lo controlla solo `leggiBackup` con la password giusta.
 */
export function leggiIntestazione(dati) {
  const { info, n, r, p } = separa(dati);
  return { creato: info.created ?? null, kdf: { alg: "scrypt", n, r, p } };
}

/**
 * Apre e controlla un backup.
 * @returns {Promise<Array<{categoria, nome, creato, modificato, origine, meta, sha256, dati: Uint8Array}>>}
 */
export async function leggiBackup(dati, password, { progresso } = {}) {
  const { intestazione, n, r, p, sale, sigillato } = separa(dati);
  const chiave = await C.deriva(utf8(password), sale, n, r, p, { progresso });
  let contenuto;
  try {
    contenuto = await C.dissigilla(chiave, sigillato, intestazione);
  } catch (e) {
    if (e instanceof C.ErroreIntegrita) throw new ErroreBackup("password sbagliata oppure backup danneggiato");
    throw e;
  } finally {
    chiave.fill(0);
  }
  let voci;
  try {
    const d = JSON.parse(daUtf8(await decomprimi(contenuto)));
    voci = d.items ?? [];
    if (!Array.isArray(voci)) throw new ErroreValore("elenco");
  } catch (e) {
    if (e instanceof ErroreValore || e instanceof SyntaxError || e instanceof TypeError) throw new ErroreBackup("contenuto del backup non valido");
    throw e;
  }
  const fuori = [];
  for (const v of voci) {
    const byte = daBase64(v.data);
    if ((await C.sha256(byte)) !== v.sha256) throw new ErroreBackup(`impronta diversa per ${strPython(v.name)}: backup alterato`);
    fuori.push({
      categoria: v.category,
      nome: v.name,
      creato: v.created,
      modificato: v.modified,
      origine: v.origin,
      meta: v.meta,
      sha256: v.sha256,
      dati: byte,
    });
  }
  return fuori;
}

/**
 * Ripristina nella cassaforte aperta; i file già presenti (stessa impronta) vengono saltati.
 * Una categoria sconosciuta diventa "altro".
 * @returns {Promise<{aggiunti: number, saltati: number}>}
 */
export async function importaBackup(cassaforte, dati, password, opzioni = {}) {
  const voci = await leggiBackup(dati, password, opzioni);
  const presenti = new Set(cassaforte.voci().map((v) => v.sha256));
  let aggiunti = 0;
  let saltati = 0;
  for (const v of voci) {
    if (presenti.has(v.sha256)) {
      saltati++;
      continue;
    }
    const origine = v.origine === undefined ? "reale" : v.origine;
    const meta = veroPython(v.meta) ? v.meta : {};
    try {
      await cassaforte.aggiungi(v.categoria, v.nome, v.dati, { origine, meta });
    } catch (e) {
      if (!(e instanceof ErroreCassaforte)) throw e;
      await cassaforte.aggiungi("altro", v.nome, v.dati, { origine, meta });
    }
    presenti.add(v.sha256);
    aggiunti++;
  }
  return { aggiunti, saltati };
}
