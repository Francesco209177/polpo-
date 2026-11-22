// Polpo Studio — sicurezza: la cassaforte cifrata.
// Porta di studio/polpo_studio/security/vault.py con gli stessi file e lo stesso formato: una cassaforte creata da
// Polpo Studio sul computer si apre qui, e viceversa (basta copiare i file; vedi archivio.js).
//
// * Una chiave dati casuale (AES-256) cifra file e metadati.
// * La chiave dati è salvata due volte, «avvolta» con chiavi ricavate (scrypt) dalla frase di accesso e dalla
//   chiave di recupero: basta una delle due per aprire la cassaforte.
// * Ogni file è cifrato con AES-256-GCM; i dati aggiuntivi autenticati (AAD) legano il contenuto al suo id e alla
//   sua versione, così un file scambiato o vecchio non passa la verifica.
// * Il PIN è solo un blocco rapido mentre l'app è aperta: senza la chiave dati in memoria non apre nulla.
//   Dopo 5 errori la chiave viene tolta dalla memoria e serve la frase.
// * «Ricorda su questo computer» (il portachiavi del sistema in Python) qui è solo un aggancio: l'opzione
//   `portachiavi` di Cassaforte.apri(), pensata per un futuro ponte verso l'Android Keystore.
//
// File (vedi archivio.js):
//   chiavi.json    in chiaro: id, parametri scrypt, chiave dati avvolta due volte, impronta del PIN
//   indice.bin     cifrato: l'elenco dei file con i loro metadati
//   oggetti/<id>   cifrati: il contenuto dei file
//
// Limiti: JavaScript non garantisce di cancellare ogni copia della chiave dalla memoria (come Python).

import * as C from "./cripto.js";
import { ErroreIntegrita } from "./cripto.js";
import {
  ErroreValore,
  casuali,
  copiaByte,
  daBase64,
  daUtf8,
  esadecimale,
  inBase64,
  jsonPython,
  lunghezzaPython,
  soloCifre,
  strPython,
  stripPython,
  unisci,
  utf8,
  veroPython,
} from "./formati.js";

export const SERVIZIO_PORTACHIAVI = "Polpo Studio";
export const MAX_ERRORI_PIN = 5;
/** Blocco automatico dopo questi minuti di inattività (predefinito di Polpo Studio; 0 = mai). Lo applica l'interfaccia. */
export const MINUTI_BLOCCO_PREDEFINITI = 10;
export const CATEGORIE = Object.freeze(["nfc", "rfid", "radio", "ir", "ibutton", "diagnostica", "configurazioni", "app", "backup", "altro"]);
/** Nomi delle categorie da mostrare (come nella pagina Archivio di Polpo Studio). */
export const NOMI_CATEGORIE = Object.freeze({
  nfc: "NFC",
  rfid: "RFID 125 kHz",
  radio: "Radio",
  ir: "Infrarossi",
  ibutton: "iButton",
  diagnostica: "Diagnostica",
  configurazioni: "Configurazioni",
  app: "App",
  backup: "Backup",
  altro: "Altro",
});
/** "reale" oppure "simulato" (dal Polpo virtuale: non si invia al Polpo vero). */
export const ORIGINI = Object.freeze(["reale", "simulato"]);

export const FILE_CHIAVI = "chiavi.json";
export const FILE_INDICE = "indice.bin";
export const CARTELLA_OGGETTI = "oggetti/";

/**
 * Errore della cassaforte, con un `codice` uguale a quello di Python:
 * "locked", "exists", "missing", "wrong", "bad_key", "corrupt", "bad_pin", "keyring", "not_found",
 * "bad_category", "bad_origin".
 */
export class ErroreCassaforte extends Error {
  constructor(codice, messaggio) {
    super(messaggio);
    this.name = "ErroreCassaforte";
    this.codice = codice;
  }
}

const chiusa = () => new ErroreCassaforte("locked", "cassaforte chiusa");

// Nell'indice le voci sono scritte con i nomi di Python e in quest'ordine (i campi della dataclass Item).
const CAMPI = ["id", "category", "name", "created", "modified", "version", "size", "sha256"];

function voceDaIndice(d) {
  if (d === null || typeof d !== "object" || Array.isArray(d)) throw new ErroreValore("voce dell'indice non valida");
  for (const k of CAMPI) if (!Object.hasOwn(d, k)) throw new ErroreValore(`voce dell'indice senza «${k}»`);
  for (const k of Object.keys(d)) if (!CAMPI.includes(k) && k !== "origin" && k !== "meta") throw new ErroreValore(`campo sconosciuto nell'indice: ${k}`);
  const r = {};
  for (const k of CAMPI) r[k] = d[k];
  r.origin = Object.hasOwn(d, "origin") ? d.origin : "reale";
  r.meta = Object.hasOwn(d, "meta") ? d.meta : {};
  return r;
}

/**
 * Una voce della cassaforte, come la vede chi la usa (una copia: cambiarla non cambia la cassaforte).
 * @typedef {{id: string, categoria: string, nome: string, creato: number, modificato: number, versione: number,
 *   dimensione: number, sha256: string, origine: "reale"|"simulato", meta: object, simulato: boolean}} Voce
 */
function vista(r) {
  return Object.freeze({
    id: r.id,
    categoria: r.category,
    nome: r.name,
    creato: r.created,
    modificato: r.modified,
    versione: r.version,
    dimensione: r.size,
    sha256: r.sha256,
    origine: r.origin,
    meta: structuredClone(r.meta),
    simulato: r.origin === "simulato",
  });
}

function copiaMeta(meta) {
  if (meta === null || meta === undefined) return {};
  if (typeof meta !== "object" || Array.isArray(meta)) throw new TypeError("meta: serve un oggetto");
  return structuredClone(meta);
}

function idCasuale() {
  // come uuid.uuid4().hex
  const b = casuali(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return esadecimale(b);
}

const adesso = () => Date.now() / 1000; // come time.time()

/** Divide l'avanzamento di più derivazioni scrypt in tratti di una sola barra. */
function tratto(progresso, da, a) {
  return progresso ? (f) => progresso(da + (a - da) * f) : undefined;
}

/**
 * La cassaforte. Si ottiene con `await Cassaforte.apri(archivio)`; poi `crea` la prima volta, `sblocca` le altre.
 * Le operazioni che cambiano qualcosa avvengono una alla volta, nell'ordine in cui sono chiamate.
 */
export class Cassaforte {
  /**
   * @param archivio   dove stanno i file (vedi archivio.js)
   * @param kdfN       costo di scrypt per una cassaforte nuova (le prove usano 2^10 per fare in fretta)
   * @param portachiavi aggancio per «Ricorda su questo dispositivo» (oggi nessuno: in futuro l'Android Keystore).
   *   Un oggetto con tre metodi asincroni, come il modulo `keyring` di Python:
   *     salva(servizio, utente, segreto), leggi(servizio, utente) → testo o null, cancella(servizio, utente)
   *   con servizio = "Polpo Studio", utente = id della cassaforte, segreto = la chiave dati in base64.
   */
  static async apri(archivio, { kdfN = C.KDF_N, portachiavi = null } = {}) {
    const c = new Cassaforte(archivio, { kdfN, portachiavi });
    await c._caricaChiavi();
    return c;
  }

  constructor(archivio, { kdfN = C.KDF_N, portachiavi = null } = {}) {
    this.archivio = archivio;
    this.kdfN = kdfN;
    this.portachiavi = portachiavi;
    this.erroriPin = 0;
    this.bloccoRapido = false;
    this._chiavi = null;
    this._dek = null;
    this._indice = new Map();
    this._derivate = new Map();
    this._coda = Promise.resolve();
  }

  // ---------------- stato ----------------

  get id() {
    return this._chiavi?.id ?? "";
  }

  /** Vero se la cassaforte è già stata creata. */
  get esiste() {
    return this._chiavi !== null;
  }

  /** Vero se la chiave dati è in memoria. */
  get aperta() {
    return this._dek !== null;
  }

  get haPin() {
    return veroPython(this._chiavi?.pin);
  }

  /** Parametri di scrypt della cassaforte ({alg, n, r, p}), da mostrare all'utente. */
  get parametriKdf() {
    return this._chiavi ? structuredClone(this._chiavi.kdf) : null;
  }

  /** Esegue `fn` dopo le operazioni già in corso (come il lucchetto di Python). */
  _esclusivo(fn) {
    const risultato = this._coda.then(fn);
    this._coda = risultato.catch(() => {});
    return risultato;
  }

  async _caricaChiavi() {
    const byte = await this.archivio.leggi(FILE_CHIAVI);
    if (byte === null) return;
    try {
      this._chiavi = JSON.parse(daUtf8(byte));
    } catch {
      throw new ErroreValore("chiavi.json illeggibile");
    }
  }

  _chiaviPresenti() {
    if (!this._chiavi) throw new ErroreCassaforte("missing", "la cassaforte non esiste ancora");
    return this._chiavi;
  }

  async _salvaChiavi(chiavi) {
    await this.archivio.scrivi(FILE_CHIAVI, utf8(jsonPython(chiavi, { rientro: 2 })));
  }

  // ---------------- chiavi ----------------

  _aad(slot, id = this.id) {
    return utf8(`polpo-vault|${id}|${slot}`);
  }

  async _avvolgi(chiavi, slot, segreto, progresso) {
    if (!this._dek) throw chiusa();
    const sale = casuali(16);
    const k = chiavi.kdf;
    const kek = await C.deriva(segreto, sale, k.n, k.r, k.p, { progresso });
    if (!this._dek) throw chiusa();
    const dek = this._dek.slice(); // copia: chiudi() azzera l'originale
    try {
      return { salt: inBase64(sale), blob: inBase64(await C.sigilla(kek, dek, this._aad(slot, chiavi.id))) };
    } finally {
      dek.fill(0);
      kek.fill(0);
    }
  }

  async _svolgi(slot, segreto, progresso) {
    const chiavi = this._chiaviPresenti();
    const s = chiavi.slots[slot];
    const k = chiavi.kdf;
    const kek = await C.deriva(segreto, daBase64(s.salt), k.n, k.r, k.p, { progresso });
    try {
      return await C.dissigilla(kek, daBase64(s.blob), this._aad(slot, chiavi.id));
    } finally {
      kek.fill(0);
    }
  }

  /** Chiave WebCrypto ricavata (HKDF) dalla chiave dati per uno scopo ("index", "objects", "pin"). */
  async _chiave(scopo, tipo = "aes") {
    if (!this._dek) throw chiusa();
    const nome = `${tipo}|${scopo}`;
    const pronta = this._derivate.get(nome);
    if (pronta) return pronta;
    const derivate = this._derivate;
    const grezza = await C.hkdf(this._dek, scopo);
    try {
      const k = tipo === "aes" ? await C.chiaveAes(grezza) : await C.chiaveHmac(grezza);
      derivate.set(nome, k); // se nel frattempo la cassaforte è stata chiusa, `derivate` non serve più a nessuno
      return k;
    } finally {
      grezza.fill(0);
    }
  }

  /** Chiave derivata (32 byte) per un altro componente, es. il registro attività (come `key_for`). */
  async chiavePer(scopo) {
    if (!this._dek) throw chiusa();
    return C.hkdf(this._dek, "ext|" + scopo);
  }

  /** Crea la cassaforte; restituisce la chiave di recupero da conservare. Poi la cassaforte resta aperta. */
  crea(frase, { progresso } = {}) {
    return this._esclusivo(async () => {
      if (this._chiavi || (await this.archivio.leggi(FILE_CHIAVI)) !== null) {
        throw new ErroreCassaforte("exists", "la cassaforte esiste già");
      }
      const chiavi = {
        format: "polpo-vault",
        version: 1,
        id: idCasuale(),
        created: adesso(),
        kdf: { alg: "scrypt", n: this.kdfN, r: C.KDF_R, p: C.KDF_P },
        slots: {},
        pin: null,
      };
      this._chiudiInterno();
      this._dek = casuali(32);
      try {
        const recupero = C.nuovaChiaveRecupero();
        chiavi.slots.frase = await this._avvolgi(chiavi, "frase", utf8(frase), tratto(progresso, 0, 0.5));
        chiavi.slots.recupero = await this._avvolgi(chiavi, "recupero", C.normalizzaChiaveRecupero(recupero), tratto(progresso, 0.5, 1));
        this._chiavi = chiavi;
        await this._salvaIndice(this._indice, await this._chiave("index"));
        await this._salvaChiavi(chiavi);
        return recupero;
      } catch (e) {
        this._chiavi = null;
        this._chiudiInterno();
        throw e;
      }
    });
  }

  /** Apre con la frase di accesso. Frase sbagliata → ErroreCassaforte "wrong". */
  sblocca(frase, { progresso } = {}) {
    return this._esclusivo(() => this._sbloccaSlot("frase", utf8(frase), "frase di accesso sbagliata", progresso));
  }

  /** Apre con la chiave di recupero (minuscole, spazi e trattini non contano). */
  sbloccaConRecupero(testo, { progresso } = {}) {
    return this._esclusivo(async () => {
      const grezza = C.normalizzaChiaveRecupero(testo);
      if (grezza === null) throw new ErroreCassaforte("bad_key", "la chiave di recupero ha 32 caratteri (lettere e cifre da 2 a 7)");
      await this._sbloccaSlot("recupero", grezza, "chiave di recupero sbagliata", progresso);
    });
  }

  async _sbloccaSlot(slot, segreto, errore, progresso) {
    if (!this._chiavi) await this._caricaChiavi();
    this._chiaviPresenti();
    let dek;
    try {
      dek = await this._svolgi(slot, segreto, progresso);
    } catch (e) {
      if (e instanceof ErroreIntegrita) throw new ErroreCassaforte("wrong", errore);
      throw e;
    }
    await this._apriCon(dek);
  }

  async _apriCon(dek) {
    this._chiudiInterno();
    this._dek = dek;
    try {
      this._indice = await this._caricaIndice();
    } catch (e) {
      this._chiudiInterno();
      if (e instanceof ErroreIntegrita || e instanceof ErroreValore) {
        throw new ErroreCassaforte("corrupt", "indice della cassaforte alterato o danneggiato");
      }
      throw e;
    }
    this.erroriPin = 0;
    this.bloccoRapido = false;
  }

  /** Toglie subito la chiave dati dalla memoria. Le operazioni già partite finiscono con le chiavi che avevano. */
  chiudi() {
    this._chiudiInterno();
  }

  _chiudiInterno() {
    if (this._dek) this._dek.fill(0);
    this._dek = null;
    this._indice = new Map();
    this._derivate = new Map();
    this.bloccoRapido = false;
  }

  /** Cambia la frase di accesso (serve quella attuale). La cassaforte deve essere aperta. */
  cambiaFrase(vecchia, nuova, { progresso } = {}) {
    return this._esclusivo(async () => {
      try {
        (await this._svolgi("frase", utf8(vecchia), tratto(progresso, 0, 0.5))).fill(0);
      } catch (e) {
        if (e instanceof ErroreIntegrita) throw new ErroreCassaforte("wrong", "frase di accesso attuale sbagliata");
        throw e;
      }
      const chiavi = structuredClone(this._chiavi);
      chiavi.slots.frase = await this._avvolgi(chiavi, "frase", utf8(nuova), tratto(progresso, 0.5, 1));
      await this._salvaChiavi(chiavi);
      this._chiavi = chiavi;
    });
  }

  /** Vero se la frase è quella giusta (non apre e non cambia nulla). */
  async verificaFrase(frase, { progresso } = {}) {
    try {
      (await this._svolgi("frase", utf8(frase), progresso)).fill(0);
      return true;
    } catch (e) {
      if (e instanceof ErroreIntegrita) return false;
      throw e;
    }
  }

  /**
   * Per lo schermo bloccato quando la cassaforte è già aperta: se la frase è giusta toglie il blocco rapido e
   * azzera gli errori del PIN (come la schermata di sblocco di Polpo Studio). Non apre una cassaforte chiusa:
   * in quel caso serve `sblocca`.
   */
  async riprendiConFrase(frase, opzioni = {}) {
    const giusta = await this.verificaFrase(frase, opzioni);
    if (giusta) {
      this.bloccoRapido = false;
      this.erroriPin = 0;
    }
    return giusta;
  }

  /** Nuova chiave di recupero (la vecchia smette di funzionare). La cassaforte deve essere aperta. */
  nuovaChiaveRecupero({ progresso } = {}) {
    return this._esclusivo(async () => {
      if (!this._dek) throw chiusa();
      const recupero = C.nuovaChiaveRecupero();
      const chiavi = structuredClone(this._chiavi);
      chiavi.slots.recupero = await this._avvolgi(chiavi, "recupero", C.normalizzaChiaveRecupero(recupero), progresso);
      await this._salvaChiavi(chiavi);
      this._chiavi = chiavi;
      return recupero;
    });
  }

  // ---------------- PIN (blocco rapido) ----------------

  /** Imposta il PIN (da 4 a 12 cifre). La cassaforte deve essere aperta. */
  async impostaPin(pin) {
    if (!(soloCifre(pin) && lunghezzaPython(pin) >= 4 && lunghezzaPython(pin) <= 12)) {
      throw new ErroreCassaforte("bad_pin", "il PIN ha da 4 a 12 cifre");
    }
    return this._esclusivo(async () => {
      const sale = casuali(16);
      const k = await this._chiave("pin", "hmac");
      const chiavi = structuredClone(this._chiaviPresenti());
      chiavi.pin = { salt: inBase64(sale), mac: await C.mac(k, unisci(sale, utf8(pin))) };
      await this._salvaChiavi(chiavi);
      this._chiavi = chiavi;
    });
  }

  togliPin() {
    return this._esclusivo(async () => {
      const chiavi = structuredClone(this._chiaviPresenti());
      chiavi.pin = null;
      await this._salvaChiavi(chiavi);
      this._chiavi = chiavi;
    });
  }

  /** Blocco dello schermo: la chiave resta in memoria, serve il PIN (o la frase) per riprendere. */
  bloccaSchermo() {
    this.bloccoRapido = true;
  }

  /** Vero se il PIN è giusto. Dopo MAX_ERRORI_PIN errori la cassaforte si chiude del tutto. */
  sbloccaPin(pin) {
    return this._esclusivo(async () => {
      if (!this._dek || !this.haPin) return false;
      const p = this._chiavi.pin;
      const k = await this._chiave("pin", "hmac");
      if (await C.macValido(k, unisci(daBase64(p.salt), utf8(String(pin))), p.mac)) {
        this.erroriPin = 0;
        this.bloccoRapido = false;
        return true;
      }
      this.erroriPin += 1;
      if (this.erroriPin >= MAX_ERRORI_PIN) this._chiudiInterno();
      return false;
    });
  }

  // ---------------- portachiavi (aggancio) ----------------

  /** «Ricorda su questo dispositivo»: salva (o toglie) la chiave dati nel portachiavi indicato in `apri`. */
  async ricordaSuQuestoDispositivo(attiva) {
    const pk = this.portachiavi;
    if (attiva) {
      if (!this._dek) throw chiusa();
      const segreto = inBase64(this._dek);
      try {
        if (!pk) throw new Error("nessun portachiavi collegato");
        await pk.salva(SERVIZIO_PORTACHIAVI, this.id, segreto);
      } catch (e) {
        throw new ErroreCassaforte("keyring", `portachiavi del sistema non disponibile: ${e?.message ?? e}`);
      }
    } else {
      try {
        await pk?.cancella(SERVIZIO_PORTACHIAVI, this.id);
      } catch {
        // come in Python: togliere una chiave che non c'è non è un errore
      }
    }
  }

  /** Prova ad aprire con la chiave salvata nel portachiavi; vero se ci riesce. */
  provaPortachiavi() {
    return this._esclusivo(async () => {
      const pk = this.portachiavi;
      if (!pk || !this._chiavi) return false;
      let segreto;
      try {
        segreto = await pk.leggi(SERVIZIO_PORTACHIAVI, this.id);
      } catch {
        return false;
      }
      if (!segreto) return false;
      try {
        await this._apriCon(daBase64(segreto));
      } catch (e) {
        if (e instanceof ErroreCassaforte || e instanceof ErroreValore) return false;
        throw e;
      }
      return true;
    });
  }

  // ---------------- indice ----------------

  _aadIndice() {
    return utf8(`polpo-index|${this.id}`);
  }

  async _caricaIndice() {
    const blob = await this.archivio.leggi(FILE_INDICE);
    if (blob === null) return new Map();
    const chiaro = await C.dissigilla(await this._chiave("index"), blob, this._aadIndice());
    let dati;
    try {
      dati = JSON.parse(daUtf8(chiaro));
    } catch {
      throw new ErroreValore("indice illeggibile");
    }
    if (dati === null || !Array.isArray(dati.items)) throw new ErroreValore("indice senza elenco dei file");
    const indice = new Map();
    for (const d of dati.items) {
      const r = voceDaIndice(d);
      indice.set(r.id, r);
    }
    return indice;
  }

  async _salvaIndice(indice, chiave) {
    const testo = utf8(jsonPython({ version: 1, items: [...indice.values()] }, { soloAscii: false }));
    await this.archivio.scrivi(FILE_INDICE, await C.sigilla(chiave, testo, this._aadIndice()));
  }

  _aadOggetto(id, versione) {
    return utf8(`polpo-obj|${this.id}|${id}|${versione}`);
  }

  _indiceAperto() {
    if (!this._dek) throw chiusa();
    return this._indice;
  }

  _record(id) {
    const indice = this._indiceAperto();
    const r = indice.get(id);
    if (!r) throw new ErroreCassaforte("not_found", "file non trovato nella cassaforte");
    return r;
  }

  // ---------------- oggetti ----------------

  /**
   * Aggiunge un file. `dati` è un Uint8Array; `origine` "reale" o "simulato"; `meta` un oggetto JSON.
   * @returns {Promise<Voce>}
   */
  async aggiungi(categoria, nome, dati, { origine = "reale", meta = null } = {}) {
    if (!CATEGORIE.includes(categoria)) throw new ErroreCassaforte("bad_category", `categoria sconosciuta: ${strPython(categoria)}`);
    if (!ORIGINI.includes(origine)) throw new ErroreCassaforte("bad_origin", "origine sconosciuta");
    const copia = copiaByte(dati);
    const m = copiaMeta(meta);
    return this._esclusivo(async () => {
      const indice = this._indiceAperto();
      const [kOggetti, kIndice] = await Promise.all([this._chiave("objects"), this._chiave("index")]);
      const ora = adesso();
      const r = { id: idCasuale(), category: categoria, name: nome, created: ora, modified: ora, version: 1, size: copia.length, sha256: await C.sha256(copia), origin: origine, meta: m };
      await this.archivio.scrivi(CARTELLA_OGGETTI + r.id, await C.sigilla(kOggetti, copia, this._aadOggetto(r.id, 1)));
      indice.set(r.id, r);
      await this._salvaIndice(indice, kIndice);
      return vista(r);
    });
  }

  /** Il contenuto di un file (Uint8Array). Alterato, scambiato o vecchio → ErroreIntegrita. */
  leggi(id) {
    return this._esclusivo(() => this._leggiInterno(id));
  }

  async _leggiInterno(id) {
    const r = this._record(id);
    const k = await this._chiave("objects");
    const blob = await this.archivio.leggi(CARTELLA_OGGETTI + id);
    if (blob === null) throw new ErroreIntegrita("file mancante nella cassaforte");
    const dati = await C.dissigilla(k, blob, this._aadOggetto(id, r.version));
    if ((await C.sha256(dati)) !== r.sha256) throw new ErroreIntegrita("impronta SHA-256 diversa");
    return dati;
  }

  /** @returns {Voce} */
  voce(id) {
    return vista(this._record(id));
  }

  /**
   * Le voci, dalla più recente; `categoria` null = tutte; `cerca` nel nome e nei metadati (minuscole o maiuscole
   * non contano).
   * @returns {Voce[]}
   */
  voci(categoria = null, cerca = "") {
    const q = stripPython(cerca ?? "").toLowerCase();
    const indice = this._indiceAperto();
    const scelte = [...indice.values()].filter(
      (r) =>
        (categoria === null || categoria === undefined || r.category === categoria) &&
        (!q || strPython(r.name).toLowerCase().includes(q) || jsonPython(r.meta, { soloAscii: false }).toLowerCase().includes(q)),
    );
    scelte.sort((a, b) => b.modified - a.modified);
    return scelte.map(vista);
  }

  /**
   * Cambia contenuto, nome o metadati di un file. `segnaSimulato` segna il file come SIMULATO (solo in quella
   * direzione: non si torna indietro).
   * @returns {Promise<Voce>}
   */
  async aggiorna(id, { dati = null, nome = null, meta = null, segnaSimulato = false } = {}) {
    const copia = dati === null || dati === undefined ? null : copiaByte(dati);
    const m = meta === null || meta === undefined ? null : copiaMeta(meta);
    return this._esclusivo(async () => {
      const indice = this._indiceAperto();
      const r = { ...this._record(id) };
      const [kOggetti, kIndice] = await Promise.all([copia ? this._chiave("objects") : null, this._chiave("index")]);
      if (segnaSimulato) r.origin = "simulato";
      if (copia) {
        r.version += 1;
        await this.archivio.scrivi(CARTELLA_OGGETTI + id, await C.sigilla(kOggetti, copia, this._aadOggetto(id, r.version)));
        r.size = copia.length;
        r.sha256 = await C.sha256(copia);
      }
      if (nome !== null && nome !== undefined) r.name = nome;
      if (m) r.meta = m;
      r.modified = adesso();
      indice.set(id, r);
      await this._salvaIndice(indice, kIndice);
      return vista(r);
    });
  }

  elimina(id) {
    return this._esclusivo(async () => {
      const indice = this._indiceAperto();
      this._record(id);
      const k = await this._chiave("index");
      indice.delete(id);
      await this._salvaIndice(indice, k);
      await this.archivio.cancella(CARTELLA_OGGETTI + id);
    });
  }

  /**
   * Decifra tutto e confronta le impronte: elenca file mancanti, alterati o estranei.
   * @returns {Promise<{idVoce: string, cosa: string}[]>} vuoto = tutto integro
   */
  verifica() {
    return this._esclusivo(async () => {
      const indice = this._indiceAperto();
      const presenti = new Set(await this.archivio.elenco(CARTELLA_OGGETTI));
      const problemi = [];
      for (const r of [...indice.values()]) {
        if (!presenti.has(CARTELLA_OGGETTI + r.id)) {
          problemi.push({ idVoce: r.id, cosa: "mancante" });
          continue;
        }
        try {
          await this._leggiInterno(r.id);
        } catch (e) {
          if (!(e instanceof ErroreIntegrita)) throw e;
          problemi.push({ idVoce: r.id, cosa: "alterato o danneggiato" });
        }
      }
      for (const nome of [...presenti].sort()) {
        const id = nome.slice(CARTELLA_OGGETTI.length);
        if (!indice.has(id) && !id.endsWith(".tmp")) problemi.push({ idVoce: id, cosa: "file estraneo nella cartella" });
      }
      return problemi;
    });
  }

  /** Quanti file, quanti byte, quanti dal Polpo virtuale. */
  statistiche() {
    const voci = [...this._indice.values()];
    return {
      numero: voci.length,
      byte: voci.reduce((s, r) => s + r.size, 0),
      simulati: voci.filter((r) => r.origin === "simulato").length,
    };
  }
}

export { ErroreIntegrita };
