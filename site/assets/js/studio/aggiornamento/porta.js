// Una porta seriale «come Web Serial» sopra il ponte PolpoNativo dell'app per Android (android/PONTE.md).
//
// Sul telefono non c'è Web Serial: la porta USB (cavo OTG) la apre l'app, e la pagina la usa solo attraverso
// PolpoNativo. esptool-js invece parla con un oggetto SerialPort di Web Serial; questa classe ne imita la parte che
// la sua classe Transport usa davvero (letta nel sorgente di esptool-js 0.7.1, lib/webserial.js):
//
//   getInfo()                          → {usbVendorId, usbProductId}, da usbElenco()
//   open({baudRate})                   → serialeApri(id, {baud, dtr, rts}); aspetta «seriale.aperta» o «seriale.errore»
//   setSignals({dataTerminalReady, requestToSend})
//                                      → serialeLinee(dtr, rts). esptool-js cambia una linea per volta
//                                        (setRTS, setDTR): qui si ricorda l'altra e si mandano sempre tutte e due
//   setBaudRate(baud)                  → serialeBaud(baud): esptool-js la usa, se c'è, invece di chiudere e riaprire
//   readable                           → ReadableStream di Uint8Array, riempito dagli eventi «seriale.dati» (base64);
//                                        esptool-js prende e rilascia il lettore a ogni pezzo (getReader/releaseLock)
//   writable                           → WritableStream: ogni pezzo va a serialeScrivi(base64), a blocchi
//   close()                            → serialeChiudi(); readable e writable tornano null, come in Web Serial
//
// Se il dispositivo si stacca («seriale.chiusa» con motivo «scollegato») il flusso in lettura finisce con un errore
// NetworkError (come Web Serial quando il dispositivo sparisce) e `scollegata` diventa vero.
//
// Le linee all'apertura sono DTR basso e RTS basso, come fa esptool sotto Windows «per non far ripartire il chip»: con
// l'USB-Serial-JTAG dell'ESP32-S3 la coppia (DTR 0, RTS 1) tiene il chip in reset, (DTR 1, RTS 0) chiede il
// bootloader al prossimo reset, (0, 0) è il riposo.

import { ascoltaNativo } from "../link/trasporti.js";
import { base64, daBase64 } from "../link/proto.js";

/** Errore della porta, con il nome che userebbe Web Serial (NetworkError, InvalidStateError, …). */
export class ErrorePorta extends Error {
  constructor(messaggio, nome = "NetworkError") {
    super(messaggio);
    this.name = nome;
  }
}

export class PortaSerialeNativa {
  /**
   * @param nativo l'oggetto PolpoNativo (o uno finto nelle prove)
   * @param dispositivo una voce di usbElenco(): {id, nome, vid, pid, ...}
   * @param opzioni {tempoApertura: ms per la risposta a serialeApri (può comparire la richiesta di permesso di
   *   Android, quindi è lungo), bloccoScrittura: byte per chiamata a serialeScrivi, linee: {dtr, rts} all'apertura}
   */
  constructor(nativo, dispositivo, { tempoApertura = 60000, bloccoScrittura = 4096, linee = { dtr: false, rts: false } } = {}) {
    this.nativo = nativo;
    this.dispositivo = dispositivo;
    this.tempoApertura = tempoApertura;
    this.bloccoScrittura = bloccoScrittura;
    this.lineeIniziali = linee;
    this.readable = null;
    this.writable = null;
    this.aperta = false;
    this.apertaUnaVolta = false;
    this.scollegata = false;
    this.ondisconnect = null; // chiamata se il dispositivo si stacca mentre la porta è aperta
    this._dtr = false;
    this._rts = false;
    this._baud = 0;
    this._lettura = null; // controllore del ReadableStream
    this._smetti = null;
  }

  /** Come SerialPort.getInfo(): VID e PID USB (undefined se l'app non li conosce). */
  getInfo() {
    const d = this.dispositivo || {};
    return {
      usbVendorId: Number.isInteger(d.vid) ? d.vid : undefined,
      usbProductId: Number.isInteger(d.pid) ? d.pid : undefined,
    };
  }

  get connected() {
    return !this.scollegata;
  }

  async open({ baudRate } = {}) {
    if (this.aperta) throw new ErrorePorta("La porta è già aperta.", "InvalidStateError");
    if (!Number.isInteger(baudRate) || baudRate <= 0) throw new ErrorePorta(`Velocità non valida: ${baudRate}`, "TypeError");
    if (baudRate === 1200) throw new ErrorePorta("1200 baud è il segnale per il bootloader: non si apre così.", "InvalidStateError");
    if (this.scollegata) throw new ErrorePorta("Il dispositivo è stato scollegato.");
    const { dtr = false, rts = false } = this.lineeIniziali || {};
    await new Promise((risolvi, rifiuta) => {
      let attesa = true;
      const finisci = (errore) => {
        if (!attesa) return;
        attesa = false;
        clearTimeout(timer);
        if (errore) {
          smetti();
          rifiuta(errore);
        } else risolvi();
      };
      const timer = setTimeout(
        () => finisci(new ErrorePorta("Il telefono non ha aperto la porta USB in tempo (permesso non concesso?).", "TimeoutError")),
        this.tempoApertura,
      );
      const smetti = ascoltaNativo((ev) => {
        if (attesa) {
          // eventi di una porta precedente (per esempio «seriale.chiusa» arrivata tardi) non contano
          if (ev.tipo === "seriale.aperta") {
            this._preparaFlussi();
            finisci(null);
          } else if (ev.tipo === "seriale.errore") {
            finisci(new ErrorePorta(ev.messaggio || "Porta USB non aperta.", "NetworkError"));
          }
          return;
        }
        this._evento(ev);
      });
      this._smetti = smetti;
      try {
        this.nativo.serialeApri(String(this.dispositivo.id), JSON.stringify({ baud: baudRate, dtr, rts }));
      } catch (e) {
        finisci(new ErrorePorta(`Porta USB non aperta: ${e.message || e}`));
      }
    });
    this.aperta = true;
    this.apertaUnaVolta = true;
    this._dtr = dtr;
    this._rts = rts;
    this._baud = baudRate;
  }

  _preparaFlussi() {
    this.readable = new ReadableStream({
      start: (c) => {
        this._lettura = c;
      },
      cancel: () => {
        this._lettura = null;
      },
    });
    const porta = this;
    this.writable = new WritableStream({
      write(pezzo) {
        if (!porta.aperta) throw new ErrorePorta(porta.scollegata ? "Il dispositivo è stato scollegato." : "La porta è chiusa.");
        const dati = pezzo instanceof Uint8Array ? pezzo : new Uint8Array(pezzo);
        for (let i = 0; i < dati.length; i += porta.bloccoScrittura) {
          let ok = false;
          try {
            ok = porta.nativo.serialeScrivi(base64(dati.subarray(i, i + porta.bloccoScrittura)));
          } catch {
            ok = false;
          }
          if (!ok) throw new ErrorePorta("Scrittura sulla porta USB non riuscita.");
        }
      },
    });
  }

  _evento(ev) {
    if (!this.aperta) return;
    if (ev.tipo === "seriale.dati") {
      const dati = daBase64(ev.dati || "");
      if (dati && dati.length && this._lettura) {
        try {
          this._lettura.enqueue(dati);
        } catch {
          /* flusso già chiuso */
        }
      }
    } else if (ev.tipo === "seriale.chiusa" || ev.tipo === "seriale.errore") {
      const scollegato = ev.tipo === "seriale.chiusa" && ev.motivo === "scollegato";
      if (scollegato) this.scollegata = true;
      this.aperta = false;
      const messaggio = scollegato
        ? "Il dispositivo è stato scollegato."
        : ev.messaggio || "La porta USB è stata chiusa dal telefono.";
      if (this._lettura) {
        try {
          this._lettura.error(new ErrorePorta(messaggio));
        } catch {
          /* già chiuso */
        }
        this._lettura = null;
      }
      if (scollegato && typeof this.ondisconnect === "function") this.ondisconnect();
    }
  }

  /** Come SerialPort.setSignals(): solo DTR e RTS (il «break» non c'è nel ponte e viene ignorato). */
  async setSignals({ dataTerminalReady, requestToSend } = {}) {
    if (!this.aperta) throw new ErrorePorta("La porta è chiusa.", "InvalidStateError");
    const dtr = dataTerminalReady === undefined ? this._dtr : !!dataTerminalReady;
    const rts = requestToSend === undefined ? this._rts : !!requestToSend;
    let ok = false;
    try {
      ok = this.nativo.serialeLinee(dtr, rts);
    } catch {
      ok = false;
    }
    if (!ok) throw new ErrorePorta("Il telefono non ha cambiato le linee DTR/RTS.");
    this._dtr = dtr;
    this._rts = rts;
  }

  /** Cambia velocità senza chiudere la porta (esptool-js la preferisce a chiudere e riaprire). */
  async setBaudRate(baud) {
    if (!this.aperta) throw new ErrorePorta("La porta è chiusa.", "InvalidStateError");
    if (!Number.isInteger(baud) || baud <= 0 || baud === 1200) throw new ErrorePorta(`Velocità non ammessa: ${baud}`, "TypeError");
    let ok = false;
    try {
      ok = this.nativo.serialeBaud(baud);
    } catch {
      ok = false;
    }
    if (!ok) throw new ErrorePorta(`Il telefono non ha cambiato la velocità a ${baud} baud.`);
    this._baud = baud;
  }

  /** Le linee come le ha impostate la pagina l'ultima volta (per le prove e il registro). */
  linee() {
    return { dtr: this._dtr, rts: this._rts, baud: this._baud };
  }

  async close() {
    const eraAperta = this.aperta;
    this.aperta = false;
    if (this._smetti) this._smetti();
    this._smetti = null;
    if (this._lettura) {
      try {
        this._lettura.close();
      } catch {
        /* già chiuso o in errore */
      }
      this._lettura = null;
    }
    this.readable = null;
    this.writable = null;
    if (eraAperta) {
      try {
        this.nativo.serialeChiudi();
      } catch {
        /* già chiusa */
      }
    }
  }
}
