// Polpo Studio — sicurezza: registro delle attività cifrato e protetto da una catena HMAC.
// Porta di studio/polpo_studio/security/audit.py, con gli stessi file (registro.log e registro.testa).
//
// Ogni riga è cifrata (AES-256-GCM) e porta l'HMAC della riga precedente: cambiare, togliere o riordinare una
// riga rompe la catena. Un piccolo file «testa» cifrato ricorda l'ultima riga, così anche il taglio delle righe
// finali viene scoperto. Le chiavi vengono dalla cassaforte (aperta): senza la cassaforte il registro non si legge.

import * as C from "./cripto.js";
import {
  ErroreValore,
  daBase64,
  daUtf8,
  inBase64,
  interoPython,
  jsonPython,
  righeNonVuote,
  strPython,
  unisci,
  utf8,
  veroPython,
} from "./formati.js";

export const ZERO = "0".repeat(64);
export const FILE_REGISTRO = "registro.log";
export const FILE_TESTA = "registro.testa";

const decodificatore = new TextDecoder("utf-8");

export class RegistroSicuro {
  /** Collega il registro alla cassaforte aperta (riprende la catena da dove era arrivata). */
  static async apri(cassaforte) {
    const [cifra, firma] = await Promise.all([cassaforte.chiavePer("registro-cifratura"), cassaforte.chiavePer("registro-hmac")]);
    let registro;
    try {
      registro = new RegistroSicuro(cassaforte.archivio, cassaforte.id, await C.chiaveAes(cifra), await C.chiaveHmac(firma));
    } finally {
      cifra.fill(0);
      firma.fill(0);
    }
    const righe = await registro._righe();
    if (righe.length) {
      try {
        const coda = JSON.parse(righe.at(-1));
        registro._seq = interoPython(coda.seq);
        registro._ultimo = strPython(coda.mac);
      } catch {
        throw new C.ErroreIntegrita("ultima riga del registro illeggibile (usa la verifica di integrità)");
      }
    }
    return registro;
  }

  constructor(archivio, idCassaforte, chiaveCifratura, chiaveHmac) {
    this.archivio = archivio;
    this._id = idCassaforte;
    this._kCifra = chiaveCifratura;
    this._kFirma = chiaveHmac;
    this._seq = 0;
    this._ultimo = ZERO;
    this._coda = Promise.resolve();
  }

  /** Dimentica le chiavi (da chiamare quando si chiude la cassaforte). */
  chiudi() {
    this._kCifra = null;
    this._kFirma = null;
  }

  _chiavi() {
    if (!this._kCifra) throw new Error("registro chiuso");
    return [this._kCifra, this._kFirma];
  }

  async _righe() {
    const byte = await this.archivio.leggi(FILE_REGISTRO);
    return byte === null ? [] : righeNonVuote(decodificatore.decode(byte));
  }

  _aad(cosa, seq = "") {
    return utf8(`polpo-${cosa}|${this._id}|${seq}`);
  }

  /**
   * Aggiunge una voce (un oggetto JSON, di solito {ts, category, message, level, simulated} come in Polpo Studio).
   * Le voci vengono scritte una alla volta, nell'ordine delle chiamate.
   */
  aggiungi(voce) {
    return this._esclusivo(async () => {
      const [kCifra, kFirma] = this._chiavi();
      const seq = this._seq + 1;
      const c = inBase64(await C.sigilla(kCifra, utf8(jsonPython(voce, { soloAscii: false })), this._aad("log", seq)));
      const m = await C.mac(kFirma, utf8(`${seq}|${c}|${this._ultimo}`));
      const riga = utf8(jsonPython({ seq, c, prev: this._ultimo, mac: m }) + "\n");
      if (typeof this.archivio.aggiungi === "function") {
        await this.archivio.aggiungi(FILE_REGISTRO, riga);
      } else {
        const prima = await this.archivio.leggi(FILE_REGISTRO);
        await this.archivio.scrivi(FILE_REGISTRO, prima ? unisci(prima, riga) : riga);
      }
      this._seq = seq;
      this._ultimo = m;
      const testa = utf8(jsonPython({ seq, mac: m }));
      await this.archivio.scrivi(FILE_TESTA, await C.sigilla(kCifra, testa, this._aad("log-head")));
    });
  }

  _esclusivo(fn) {
    const risultato = this._coda.then(fn);
    this._coda = risultato.catch(() => {});
    return risultato;
  }

  /** Le voci decifrate (le ultime `ultime`, se indicato); le righe illeggibili vengono saltate (le segnala `verifica`). */
  async leggi(ultime = null) {
    const [kCifra] = this._chiavi();
    let righe = await this._righe();
    if (ultime !== null && ultime !== undefined) righe = righe.slice(-ultime);
    const voci = [];
    for (const riga of righe) {
      try {
        const d = JSON.parse(riga);
        voci.push(JSON.parse(daUtf8(await C.dissigilla(kCifra, daBase64(d.c), this._aad("log", strPython(d.seq))))));
      } catch {
        continue;
      }
    }
    return voci;
  }

  /** L'elenco dei problemi, con gli stessi messaggi di Polpo Studio (vuoto = registro integro). */
  async verifica() {
    const [kCifra, kFirma] = this._chiavi();
    const problemi = [];
    const righe = await this._righe();
    let prec = ZERO;
    let atteso = 1;
    for (let i = 0; i < righe.length; i++) {
      const n = i + 1;
      let seq, c, p, m;
      try {
        const d = JSON.parse(righe[i]);
        if (d === null || typeof d !== "object" || Array.isArray(d)) throw new TypeError("riga");
        for (const k of ["seq", "c", "prev", "mac"]) if (!Object.hasOwn(d, k)) throw new ErroreValore(k);
        seq = interoPython(d.seq);
        c = strPython(d.c);
        p = strPython(d.prev);
        m = strPython(d.mac);
      } catch {
        problemi.push(`riga ${n}: formato non valido`);
        prec = "";
        continue;
      }
      if (seq !== atteso) problemi.push(`riga ${n}: numero ${seq} invece di ${atteso} (righe tolte o spostate)`);
      if (p !== prec) problemi.push(`riga ${n}: non segue la riga precedente`);
      if (!(await C.macValido(kFirma, utf8(`${seq}|${c}|${p}`), m))) problemi.push(`riga ${n}: HMAC non valido (riga modificata)`);
      try {
        await C.dissigilla(kCifra, daBase64(c), this._aad("log", seq));
      } catch (e) {
        if (!(e instanceof ErroreValore || e instanceof C.ErroreIntegrita)) throw e;
        problemi.push(`riga ${n}: contenuto alterato`);
      }
      prec = m;
      atteso = seq + 1;
    }
    const testa = await this.archivio.leggi(FILE_TESTA);
    if (testa !== null) {
      try {
        const h = JSON.parse(daUtf8(await C.dissigilla(kCifra, testa, this._aad("log-head"))));
        if (h === null || typeof h !== "object" || !Object.hasOwn(h, "seq") || !Object.hasOwn(h, "mac")) throw new ErroreValore("testa");
        if (righe.length && (h.seq !== atteso - 1 || h.mac !== prec)) problemi.push("le ultime righe del registro sono state tolte o sostituite");
        if (!righe.length && veroPython(h.seq)) problemi.push("il registro è stato svuotato");
      } catch (e) {
        if (!(e instanceof ErroreValore || e instanceof C.ErroreIntegrita || e instanceof SyntaxError)) throw e;
        problemi.push("file di controllo del registro alterato");
      }
    } else if (righe.length) {
      problemi.push("manca il file di controllo del registro");
    }
    return problemi;
  }
}
