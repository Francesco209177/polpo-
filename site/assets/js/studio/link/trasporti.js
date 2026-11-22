// Trasporti per Polpo Link: le righe vanno e vengono dal Polpo vero (cavo USB, tramite l'app per Android o Web
// Serial del browser) oppure dal Polpo virtuale, cioè il firmware vero eseguito qui dentro (SIMULATO).

import { DivisoreRighe, RIGA_IN_ARRIVO_MAX, testoRiga, base64, daBase64 } from "./proto.js";
import { ErroreTrasporto } from "./client.js";

const enc = new TextEncoder();

/** Righe da un flusso di byte: chiama `suRiga(testo)` per ogni riga completa e valida. */
function lettoreRighe(suRiga) {
  const div = new DivisoreRighe(RIGA_IN_ARRIVO_MAX);
  return (dati) => {
    for (const riga of div.aggiungi(dati)) {
      if (riga === null) continue; // riga troppo lunga: scartata
      const t = testoRiga(riga);
      if (t !== null && t.length) suRiga(t);
    }
  };
}

/**
 * Il Polpo virtuale: il firmware del Cardputer compilato in WebAssembly (simulatore/firmware.js), con la sua porta
 * seriale collegata al client. Il collegamento va accettato sul suo schermo, come sul Polpo vero.
 * `polpo` è l'oggetto di creaPolpo(), già avviato. Con `avanzaDaSe` il trasporto lo fa anche avanzare nel tempo finché è
 * aperto (nelle prove); nella pagina lo fa avanzare chi disegna lo schermo.
 */
export class TrasportoVirtuale {
  constructor(polpo, { passo = 20, adesso = () => performance.now(), avanzaDaSe = true } = {}) {
    this.polpo = polpo;
    this.simulato = true;
    this.nome = "Polpo virtuale";
    this.passo = passo;
    this.adesso = adesso;
    this.avanzaDaSe = avanzaDaSe;
    this._timer = null;
    this._suChiusura = null;
  }

  async apri(suRiga, suChiusura) {
    this._suChiusura = suChiusura;
    this.polpo.mondo({ cmd: "pc", collegato: true });
    const leggi = lettoreRighe(suRiga);
    let prima = this.adesso();
    this.polpo.serialeLeggi(); // ciò che il firmware ha scritto prima del collegamento non interessa
    this._timer = setInterval(() => {
      const ora = this.adesso();
      if (this.avanzaDaSe) this.polpo.avanza(Math.min(200, ora - prima));
      prima = ora;
      const testo = this.polpo.serialeLeggi();
      if (testo) leggi(enc.encode(testo));
    }, this.passo);
  }

  scriviRiga(riga) {
    if (this._timer === null) throw new ErroreTrasporto("porta chiusa");
    const dati = new Uint8Array(riga.length + 1);
    dati.set(riga);
    dati[riga.length] = 0x0a;
    this.polpo.serialeScrivi(dati);
  }

  async chiudi() {
    if (this._timer !== null) clearInterval(this._timer);
    this._timer = null;
  }

  /** Come staccare il cavo (per le prove). */
  scollega() {
    this.chiudi();
    this.polpo.mondo({ cmd: "pc", collegato: false });
    if (this._suChiusura) this._suChiusura("scollegato");
  }
}

/**
 * Il Polpo vero collegato al telefono con un cavo USB (OTG), tramite l'app per Android (oggetto PolpoNativo).
 * L'app manda i dati con window.__polpoNativo({tipo, ...}): «seriale.dati» (base64), «seriale.chiusa».
 */
export class TrasportoAndroid {
  constructor(dispositivo, nativo = globalThis.PolpoNativo) {
    this.dispositivo = dispositivo; // {id, nome}
    this.nativo = nativo;
    this.simulato = false;
    this.nome = dispositivo.nome || "Polpo (USB)";
    this._aperto = false;
  }

  apri(suRiga, suChiusura) {
    const leggi = lettoreRighe(suRiga);
    return new Promise((risolvi, rifiuta) => {
      let attesa = true;
      this._smetti = ascoltaNativo((ev) => {
        if (ev.tipo === "seriale.aperta" && attesa) { attesa = false; this._aperto = true; risolvi(); }
        else if (ev.tipo === "seriale.errore" && attesa) { attesa = false; rifiuta(new ErroreTrasporto(ev.messaggio || "porta non aperta")); }
        else if (ev.tipo === "seriale.dati" && this._aperto) {
          const dati = daBase64(ev.dati || "");
          if (dati) leggi(dati);
        } else if (ev.tipo === "seriale.chiusa" && this._aperto) {
          this._aperto = false;
          if (this._smetti) this._smetti();
          suChiusura(ev.motivo === "scollegato" ? "scollegato" : "porta chiusa");
        }
      });
      this.nativo.serialeApri(String(this.dispositivo.id));
    });
  }

  scriviRiga(riga) {
    if (!this._aperto) throw new ErroreTrasporto("porta chiusa");
    const dati = new Uint8Array(riga.length + 1);
    dati.set(riga);
    dati[riga.length] = 0x0a;
    if (!this.nativo.serialeScrivi(base64(dati))) throw new ErroreTrasporto("scrittura sulla porta USB non riuscita");
  }

  async chiudi() {
    this._aperto = false;
    if (this._smetti) this._smetti();
    try { this.nativo.serialeChiudi(); } catch { /* già chiusa */ }
  }
}

/** I dispositivi USB seriali collegati al telefono (vuoto fuori dall'app per Android). */
export function dispositiviAndroid(nativo = globalThis.PolpoNativo) {
  if (!nativo || !nativo.serialeElenco) return [];
  try { return JSON.parse(nativo.serialeElenco()); } catch { return []; }
}

const ascoltatoriNativi = new Set();
/** Riceve gli eventi dell'app per Android ({tipo, ...}); restituisce la funzione per smettere. */
export function ascoltaNativo(fn) {
  ascoltatoriNativi.add(fn);
  globalThis.__polpoNativo = (ev) => {
    const e = typeof ev === "string" ? JSON.parse(ev) : ev;
    for (const f of [...ascoltatoriNativi]) f(e);
  };
  return () => ascoltatoriNativi.delete(fn);
}

/**
 * Il Polpo vero collegato al computer, con Web Serial (Chrome o Edge su computer). Stesse regole di Polpo Studio:
 * DTR attivo e RTS basso, mai 1200 baud (è il segnale per il bootloader).
 */
export class TrasportoWebSerial {
  constructor(porta) {
    this.porta = porta;
    this.simulato = false;
    this.nome = "Polpo (USB)";
    this._scrittore = null;
    this._lettore = null;
  }

  async apri(suRiga, suChiusura) {
    try {
      await this.porta.open({ baudRate: 115200 });
      await this.porta.setSignals({ dataTerminalReady: true, requestToSend: false });
    } catch (e) {
      throw new ErroreTrasporto(`Impossibile aprire la porta: ${e.message || e}`);
    }
    this._scrittore = this.porta.writable.getWriter();
    this._lettore = this.porta.readable.getReader();
    const leggi = lettoreRighe(suRiga);
    (async () => {
      let motivo = "porta chiusa";
      try {
        for (;;) {
          const { value, done } = await this._lettore.read();
          if (done) break;
          if (value) leggi(value);
        }
      } catch { motivo = "scollegato"; }
      if (this._scrittore) suChiusura(motivo);
    })();
  }

  scriviRiga(riga) {
    if (!this._scrittore) throw new ErroreTrasporto("porta chiusa");
    const dati = new Uint8Array(riga.length + 1);
    dati.set(riga);
    dati[riga.length] = 0x0a;
    this._scrittore.write(dati).catch(() => {});
  }

  async chiudi() {
    const s = this._scrittore, l = this._lettore;
    this._scrittore = null;
    this._lettore = null;
    try { if (l) { await l.cancel(); l.releaseLock(); } } catch { /* già chiusa */ }
    try { if (s) s.releaseLock(); } catch { /* già chiusa */ }
    try { await this.porta.close(); } catch { /* già chiusa */ }
  }
}
