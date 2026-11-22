// Client Polpo Link: richieste numerate, una alla volta, con ping periodico e trasferimento dei file.
// È la copia JavaScript di studio/polpo_studio/devices/link_client.py, con le stesse regole: una richiesta per volta
// (il Polpo risponde «busy» se ne riceve un'altra), nuovo tentativo dopo «busy», ping ogni 10 secondi che risponde
// anche mentre il Polpo è occupato, file a blocchi da 768 byte con controllo CRC-32.

import * as P from "./proto.js";

export const TEMPO_PREDEFINITO = 6000;
// Tempo massimo per comando (ms): alcune operazioni aspettano la conferma sullo schermo del Polpo (20 s).
export const TEMPI = Object.freeze({
  hello: 35000,
  "rf.tx": 35000,
  "nfc.write_ndef": 45000,
  "script.run": 35000,
  "wifi.scan": 15000,
  "ble.scan": 16000,
  diag: 10000,
});
export const TEMPO_PING = 5000;
export const PING_MANCATI_SENZA_RISPOSTA = 3;

/** Gli stati del collegamento. */
export const STATO = Object.freeze({
  CHIUSO: "chiuso", // porta chiusa
  APERTO: "aperto", // porta aperta, collegamento non ancora accettato sul Polpo
  ATTESA: "attesa_conferma", // in attesa della conferma sullo schermo del Polpo
  COLLEGATO: "collegato",
});

export class ErroreLink extends Error {
  constructor(codice, messaggio) {
    super(messaggio);
    this.name = "ErroreLink";
    this.codice = codice;
  }
}

/** Un trasporto non riesce a scrivere o ad aprirsi. */
export class ErroreTrasporto extends Error {
  constructor(messaggio) {
    super(messaggio);
    this.name = "ErroreTrasporto";
  }
}

/**
 * Il client. Il trasporto offre:
 *   apri(suRiga(testo), suChiusura(motivo)) → Promise, scriviRiga(Uint8Array), chiudi() → Promise, simulato, nome.
 */
export class ClientLink {
  constructor(trasporto, { nomeClient = "Polpo Studio (telefono)", intervalloPing = 10000, suEvento = null, suStato = null, attesaOccupato = 300, adesso = () => performance.now() } = {}) {
    this.trasporto = trasporto;
    this.nomeClient = nomeClient;
    this.intervalloPing = intervalloPing;
    this.suEvento = suEvento;
    this.suStato = suStato;
    this.attesaOccupato = attesaOccupato;
    this.adesso = adesso;
    this.stato = STATO.CHIUSO;
    this.info = {};
    this.risponde = true;
    this._id = 0;
    this._coda = [];
    this._inCorso = null;
    this._ping = new Map();
    this._riprovaDa = 0;
    this._ultimoPing = 0;
    this._pingMancati = 0;
    this._timer = null;
  }

  get simulato() {
    return !!this.trasporto.simulato;
  }

  // ---------------- ciclo di vita ----------------

  async apri() {
    await this.trasporto.apri((riga) => this._suRiga(riga), (motivo) => this._suChiusura(motivo));
    this._imposta(STATO.APERTO, "porta aperta");
    this._timer = setInterval(() => this._manutenzione(), 100);
  }

  async chiudi(inviaBye = true) {
    if (this.stato === STATO.COLLEGATO && inviaBye) {
      try { await this.richiesta("bye", null, 1500); } catch { /* il Polpo può essere già andato */ }
    }
    this._ferma();
    try {
      await this.trasporto.chiudi();
    } finally {
      this._fallisciTutto(new ErroreLink("closed", "collegamento chiuso"));
      this._imposta(STATO.CHIUSO, "chiuso dall'app");
    }
  }

  /** Verifica che dall'altra parte ci sia un Polpo («ping» non richiede la conferma). */
  async sonda(tempo = 2500) {
    let dati;
    try {
      dati = await this.richiesta("ping", null, tempo);
    } catch (e) {
      if (e.codice === "timeout") throw new ErroreLink("not_polpo", "Nessuna risposta: su questa porta non c'è un Polpo con Polpo Link");
      throw e;
    }
    if (!dati.pong) throw new ErroreLink("not_polpo", "Risposta inattesa: non sembra un Polpo");
    if (dati.proto !== P.VERSIONE_PROTOCOLLO) {
      throw new ErroreLink("unsupported", `Il Polpo usa il protocollo ${dati.proto}, l'app il ${P.VERSIONE_PROTOCOLLO}: aggiorna il firmware`);
    }
    return dati;
  }

  /** Chiede il collegamento: bisogna accettarlo sullo schermo del Polpo. */
  async hello(tempo) {
    this._imposta(STATO.ATTESA, "conferma sul Polpo");
    let info;
    try {
      info = await this.richiesta("hello", { client: this.nomeClient }, tempo);
    } catch (e) {
      if (this.stato === STATO.ATTESA) this._imposta(STATO.APERTO, "collegamento non accettato");
      throw e;
    }
    this.info = info;
    this._ultimoPing = this.adesso();
    this._imposta(STATO.COLLEGATO, "collegato");
    return info;
  }

  // ---------------- richieste ----------------

  /** Invia un comando; la promessa si risolve con `data` della risposta o fallisce con ErroreLink. */
  richiesta(cmd, args = null, tempo = undefined) {
    if (this.stato === STATO.CHIUSO) return Promise.reject(new ErroreLink("closed", "Polpo non collegato"));
    this._id = (this._id + 1) & 0x7fffffff;
    const id = this._id;
    const oggetto = { id, cmd };
    if (args && Object.keys(args).length) oggetto.args = args;
    const riga = P.codifica(oggetto);
    if (riga.length > P.RIGA_MAX) return Promise.reject(new ErroreLink("line_too_long", "richiesta oltre 2048 byte"));
    const t = tempo ?? (cmd === "ping" ? TEMPO_PING : TEMPI[cmd] ?? TEMPO_PREDEFINITO);
    return new Promise((risolvi, rifiuta) => {
      const r = { id, cmd, riga, risolvi, rifiuta, scadenza: this.adesso() + t, finita: false };
      if (cmd === "ping") { // il Polpo risponde al ping anche mentre è occupato
        this._ping.set(id, r);
        this._invia([r]);
      } else {
        this._coda.push(r);
        this._invia(this._pompa());
      }
    });
  }

  _pompa() {
    if (this._inCorso === null && this._coda.length && this.adesso() >= this._riprovaDa) {
      this._inCorso = this._coda.shift();
      return [this._inCorso];
    }
    return [];
  }

  _invia(richieste) {
    for (const r of richieste) {
      try {
        this.trasporto.scriviRiga(r.riga);
      } catch (e) {
        this._completa(r, new ErroreLink("io_error", e.message || String(e)));
      }
    }
  }

  _completa(r, esito) {
    if (this._inCorso === r) this._inCorso = null;
    this._ping.delete(r.id);
    if (!r.finita) {
      r.finita = true;
      if (esito instanceof Error) r.rifiuta(esito);
      else r.risolvi(esito);
    }
    this._invia(this._pompa());
  }

  // ---------------- ricezione ----------------

  _suRiga(testo) {
    let msg;
    try { msg = JSON.parse(testo); } catch { return; }
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return;
    if ("ev" in msg) {
      const ev = String(msg.ev);
      const dati = msg.data && typeof msg.data === "object" && !Array.isArray(msg.data) ? msg.data : {};
      if (ev === "link.closed") {
        this._fallisciTutto(new ErroreLink("not_connected", "collegamento chiuso sul Polpo"));
        this._imposta(STATO.APERTO, "chiuso sul Polpo");
      }
      if (this.suEvento) this.suEvento(ev, dati);
      return;
    }
    const id = msg.id;
    if (!Number.isInteger(id)) return;
    let r = this._ping.get(id);
    if (!r && this._inCorso && (id === this._inCorso.id || id === 0)) r = this._inCorso;
    if (!r) return; // risposta in ritardo a una richiesta già scaduta
    if (msg.ok === true) {
      if (r.cmd === "ping") {
        this._pingMancati = 0;
        if (!this.risponde) {
          this.risponde = true;
          this._notifica("risponde di nuovo");
        }
      }
      const dati = msg.data && typeof msg.data === "object" && !Array.isArray(msg.data) ? msg.data : {};
      this._completa(r, dati);
      return;
    }
    const err = msg.error && typeof msg.error === "object" ? msg.error : {};
    const codice = String(err.code ?? "io_error"), testoErr = String(err.msg ?? "errore sconosciuto");
    if (codice === "busy" && r.cmd !== "ping" && this.adesso() + this.attesaOccupato < r.scadenza) {
      if (this._inCorso === r) { // il Polpo sta finendo un'altra operazione: riprova tra poco
        this._inCorso = null;
        this._coda.unshift(r);
        this._riprovaDa = this.adesso() + this.attesaOccupato;
      }
      return;
    }
    if (codice === "not_connected" && this.stato === STATO.COLLEGATO) this._imposta(STATO.APERTO, "sessione scaduta sul Polpo");
    this._completa(r, new ErroreLink(codice, testoErr));
  }

  _suChiusura(motivo) {
    this._ferma();
    this._fallisciTutto(new ErroreLink("closed", motivo === "scollegato" ? "Polpo scollegato" : "porta chiusa"));
    this._imposta(STATO.CHIUSO, motivo === "scollegato" ? "scollegato" : motivo);
  }

  // ---------------- manutenzione ----------------

  _manutenzione() {
    const ora = this.adesso();
    const scadute = [];
    if (this._inCorso && ora > this._inCorso.scadenza) scadute.push(this._inCorso);
    this._coda = this._coda.filter((r) => (ora > r.scadenza ? (scadute.push(r), false) : true));
    for (const r of this._ping.values()) if (ora > r.scadenza) scadute.push(r);
    for (const r of scadute) {
      if (r.cmd === "ping") {
        this._pingMancati++;
        if (this._pingMancati >= PING_MANCATI_SENZA_RISPOSTA && this.risponde) {
          this.risponde = false;
          this._notifica("non risponde");
        }
      }
      this._completa(r, new ErroreLink("timeout", "il Polpo non ha risposto in tempo"));
    }
    this._invia(this._pompa());
    if (this.stato === STATO.COLLEGATO && ora - this._ultimoPing >= this.intervalloPing) {
      this._ultimoPing = ora;
      this.richiesta("ping").catch(() => {}); // l'esito conta solo per «risponde»
    }
  }

  _ferma() {
    if (this._timer !== null) clearInterval(this._timer);
    this._timer = null;
  }

  _fallisciTutto(errore) {
    const tutte = [...this._coda, ...this._ping.values()];
    if (this._inCorso) tutte.push(this._inCorso);
    this._coda = [];
    this._ping.clear();
    this._inCorso = null;
    for (const r of tutte) {
      if (!r.finita) {
        r.finita = true;
        r.rifiuta(errore);
      }
    }
  }

  _imposta(stato, perche) {
    const cambiato = stato !== this.stato;
    this.stato = stato;
    if (cambiato) this._notifica(perche);
  }

  _notifica(perche) {
    if (this.suStato) {
      try { this.suStato(this.stato, perche); } catch (e) { console.error("errore nel gestore dello stato", e); }
    }
  }

  // ---------------- file ----------------

  /** Legge un file dalla microSD del Polpo (fino a 256 KB), a blocchi con controllo CRC-32. */
  async leggiFile(percorso, progresso = null) {
    const parti = [];
    let posizione = 0;
    for (;;) {
      let d, blocco = null;
      for (let tentativo = 0; tentativo < 3 && blocco === null; tentativo++) {
        d = await this.richiesta("fs.read", { path: percorso, offset: posizione, len: P.BLOCCO_MAX });
        const dimensione = Number(d.size ?? 0);
        if (dimensione > P.FILE_MAX) throw new ErroreLink("too_large", "file oltre 256 KB");
        const b = P.daBase64(String(d.data ?? ""));
        if (b !== null && P.crc32(b) === d.crc32) blocco = b;
      }
      if (blocco === null) throw new ErroreLink("io_error", "blocco danneggiato tre volte: controlla il cavo USB");
      parti.push(blocco);
      posizione += blocco.length;
      if (progresso) progresso(posizione, Number(d.size ?? 0));
      if (d.eof || !blocco.length) break;
    }
    const uscita = new Uint8Array(posizione);
    let o = 0;
    for (const p of parti) { uscita.set(p, o); o += p.length; }
    return uscita;
  }

  /** Scrive un file nella microSD del Polpo, a blocchi; dentro /polpo/badusb il Polpo chiede conferma. */
  async scriviFile(percorso, dati, progresso = null) {
    if (dati.length > P.FILE_MAX) throw new ErroreLink("too_large", "file oltre 256 KB");
    if (!P.percorsoValido(percorso)) throw new ErroreLink("bad_args", "percorso non valido (solo dentro /polpo, senza spazi né accenti)");
    const blocchi = [];
    for (let i = 0; i < dati.length; i += P.BLOCCO_MAX) blocchi.push(dati.subarray(i, i + P.BLOCCO_MAX));
    if (!blocchi.length) blocchi.push(new Uint8Array(0));
    let posizione = 0;
    for (let i = 0; i < blocchi.length; i++) {
      const b = blocchi[i];
      const conferma = posizione === 0 && P.percorsoSensibile(percorso);
      await this.richiesta("fs.write", {
        path: percorso, offset: posizione, data: P.base64(b), crc32: P.crc32(b), final: i === blocchi.length - 1,
      }, conferma ? 35000 : undefined);
      posizione += b.length;
      if (progresso) progresso(posizione, dati.length);
    }
  }
}
