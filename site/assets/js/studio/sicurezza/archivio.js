// Polpo Studio — sicurezza: dove la cassaforte tiene i suoi file.
//
// In Python la cassaforte è una cartella: chiavi.json, indice.bin, oggetti/<id>, registro.log, registro.testa.
// Qui la cassaforte parla con un «archivio», un oggetto con questi metodi asincroni che usano gli stessi nomi
// (con «/» tra cartella e file), così i file si possono copiare tali e quali tra computer e telefono:
//
//   leggi(nome)          → Uint8Array con il contenuto, oppure null se il file non c'è
//   scrivi(nome, dati)   → sostituisce il file in un colpo solo (come `_write_atomic` in Python)
//   cancella(nome)       → toglie il file; nessun errore se non c'è
//   elenco(prefisso)     → i nomi dei file che cominciano con `prefisso`, in ordine
//   aggiungi(nome, dati) → facoltativo: accoda i byte in fondo al file (lo usa il registro; se manca, legge e riscrive)
//
// Qui ci sono due archivi: in memoria (per le prove e le cassaforti usa e getta) e IndexedDB (nel browser e nella
// WebView di Android). Le prove su Node usano anche un archivio su cartella, per aprire le cassaforti di Python.

import { unisci } from "./formati.js";

/** Archivio in memoria: un Map nome → byte. */
export class ArchivioMemoria {
  constructor(file = null) {
    this.file = new Map();
    if (file) for (const [nome, dati] of file instanceof Map ? file : Object.entries(file)) this.file.set(nome, Uint8Array.from(dati));
  }

  async leggi(nome) {
    const dati = this.file.get(nome);
    return dati ? dati.slice() : null;
  }

  async scrivi(nome, dati) {
    this.file.set(nome, Uint8Array.from(dati));
  }

  async aggiungi(nome, dati) {
    const prima = this.file.get(nome);
    this.file.set(nome, prima ? unisci(prima, dati) : Uint8Array.from(dati));
  }

  async cancella(nome) {
    this.file.delete(nome);
  }

  async elenco(prefisso = "") {
    return [...this.file.keys()].filter((n) => n.startsWith(prefisso)).sort();
  }
}

// ---------------- IndexedDB ----------------

/** I database del Polpo in IndexedDB hanno tutti questo prefisso. */
export const PREFISSO_DB = "polpo-";
const VERSIONE_DB = 1;
const DEPOSITO = "file";

function esito(richiesta) {
  return new Promise((ok, ko) => {
    richiesta.onsuccess = () => ok(richiesta.result);
    richiesta.onerror = () => ko(richiesta.error);
  });
}

function fine(transazione) {
  return new Promise((ok, ko) => {
    transazione.oncomplete = () => ok();
    transazione.onerror = () => ko(transazione.error);
    transazione.onabort = () => ko(transazione.error ?? new Error("operazione su IndexedDB annullata"));
  });
}

function comeByte(v) {
  return v instanceof Uint8Array ? v : new Uint8Array(v);
}

/**
 * Archivio in IndexedDB: un database «polpo-<nome>» con un deposito «file» (chiave = nome del file,
 * valore = Uint8Array). Ogni scrittura è una transazione: o va a buon fine tutta o non cambia nulla.
 */
export class ArchivioIndexedDB {
  /** Apre (o crea) il database «polpo-<nome>». */
  static async apri(nome = "cassaforte", { indexedDB = globalThis.indexedDB } = {}) {
    if (!indexedDB) throw new Error("IndexedDB non disponibile in questo browser");
    const richiesta = indexedDB.open(PREFISSO_DB + nome, VERSIONE_DB);
    richiesta.onupgradeneeded = () => {
      const db = richiesta.result;
      if (!db.objectStoreNames.contains(DEPOSITO)) db.createObjectStore(DEPOSITO);
    };
    return new ArchivioIndexedDB(await esito(richiesta), PREFISSO_DB + nome);
  }

  /** Cancella del tutto il database «polpo-<nome>» (attenzione: i dati della cassaforte spariscono). */
  static async elimina(nome = "cassaforte", { indexedDB = globalThis.indexedDB } = {}) {
    await esito(indexedDB.deleteDatabase(PREFISSO_DB + nome));
  }

  constructor(db, nome) {
    this.db = db;
    this.nome = nome;
    db.onversionchange = () => db.close();
  }

  _transazione(modo) {
    // «strict»: la scrittura è su disco quando la promessa si risolve (dove il browser lo permette)
    return this.db.transaction(DEPOSITO, modo, modo === "readwrite" ? { durability: "strict" } : undefined);
  }

  async leggi(nome) {
    const v = await esito(this._transazione("readonly").objectStore(DEPOSITO).get(nome));
    return v === undefined ? null : comeByte(v).slice();
  }

  async scrivi(nome, dati) {
    const t = this._transazione("readwrite");
    t.objectStore(DEPOSITO).put(Uint8Array.from(dati), nome);
    await fine(t);
  }

  async aggiungi(nome, dati) {
    const t = this._transazione("readwrite");
    const deposito = t.objectStore(DEPOSITO);
    const nuovi = Uint8Array.from(dati);
    const r = deposito.get(nome);
    r.onsuccess = () => deposito.put(r.result === undefined ? nuovi : unisci(comeByte(r.result), nuovi), nome);
    await fine(t);
  }

  async cancella(nome) {
    const t = this._transazione("readwrite");
    t.objectStore(DEPOSITO).delete(nome);
    await fine(t);
  }

  async elenco(prefisso = "") {
    const t = this._transazione("readonly");
    const nomi = [];
    await new Promise((ok, ko) => {
      const r = t.objectStore(DEPOSITO).openKeyCursor(prefisso ? IDBKeyRange.lowerBound(prefisso) : null);
      r.onerror = () => ko(r.error);
      r.onsuccess = () => {
        const c = r.result;
        if (!c) return ok();
        if (typeof c.key === "string") {
          if (!c.key.startsWith(prefisso)) return ok(); // le chiavi sono in ordine: finiti quelli col prefisso
          nomi.push(c.key);
        }
        c.continue();
      };
    });
    return nomi;
  }

  chiudi() {
    this.db.close();
  }
}
