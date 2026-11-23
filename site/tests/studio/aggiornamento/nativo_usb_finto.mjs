// Il ponte PolpoNativo finto per le prove dell'aggiornamento: la parte USB di android/PONTE.md, con un cavo OTG, il
// Polpo (un Esp32s3Finto) e la sua vita sul bus USB: col firmware è un dispositivo TinyUSB CDC, dopo il tocco a 1200
// baud si stacca e ricompare come USB-Serial-JTAG della ROM (un dispositivo nuovo, con un altro id), dopo il reset
// finale si stacca di nuovo e ricompare col firmware.
//
// Come l'app vera, i metodi rispondono subito e gli eventi arrivano dopo, in ordine, con window.__polpoNativo.
// `registro` tiene le chiamate della pagina (e i comandi che arrivano al chip) nell'ordine in cui sono successe.

import { Esp32s3Finto } from "./esp32s3_finto.mjs";

const b64 = (byte) => Buffer.from(byte).toString("base64");

export class NativoUsbFinto {
  /**
   * @param o.dopoTocco cosa fa il Polpo dopo il tocco a 1200 baud: "bootloader" (ricompare nella ROM), "sparisce"
   *   (non ricompare), "niente" (resta col firmware)
   * @param o.chipRom come si presenta la ROM: le opzioni di Esp32s3Finto ({chip, stubAtteso, ...})
   * @param o.risorse {percorso: Uint8Array} per risorsaBase64
   * @param o.altri dispositivi USB in più già collegati (voci di usbElenco)
   * @param o.pezzo byte massimi per evento «seriale.dati» (64: un pacchetto USB full-speed)
   * @param o.ritardi ms: {stacco, ricomparsa} dopo un tocco o un riavvio
   * @param o.toccoRifiutato il telefono risponde al tocco con ok: false
   * @param o.inizio "app" (il Polpo col firmware, predefinito) oppure "rom" (già nel bootloader)
   */
  constructor({ dopoTocco = "bootloader", chipRom = {}, risorse = {}, altri = [], pezzo = 64, ritardi = {}, toccoRifiutato = false, inizio = "app" } = {}) {
    this.dopoTocco = dopoTocco;
    this.risorse = risorse;
    this.pezzo = pezzo;
    this.ritardi = { stacco: 20, ricomparsa: 60, ...ritardi };
    this.toccoRifiutato = toccoRifiutato;
    this.registro = [];
    this.eventi = [];
    this.chiamateElenco = 0;
    this.esp = new Esp32s3Finto(chipRom);
    this.esp.onRiavvio = (modo) => this._riavviato(modo);
    this.esp.invia = (byte) => this._daChip(byte);
    this._numero = 2;
    if (inizio === "rom") this.esp.modo = "rom";
    this.dispositivi = [this._voce(inizio), ...altri];
    this.porta = null;
    this._coda = [];
    this._inCoda = false;
    const comandi = this.esp.comandi;
    const push = comandi.push.bind(comandi);
    comandi.push = (c) => {
      this.registro.push({ comando: c.op, modo: c.modo });
      return push(c);
    };
  }

  _voce(ruolo) {
    const id = `/dev/bus/usb/001/${String(this._numero++).padStart(3, "0")}`;
    return ruolo === "app"
      ? { id, nome: "Polpo", produttore: "Espressif", vid: 0x303a, pid: 0x1001, classi: [2, 10, 3], seriale: true, polpo: true, permesso: true, ruolo }
      : { id, nome: "USB JTAG/serial debug unit", produttore: "Espressif", vid: 0x303a, pid: 0x1001, classi: [2, 10, 255], seriale: true, polpo: true, permesso: false, ruolo };
  }

  // ---- eventi, in ordine e dopo ----

  emetti(ev) {
    this._coda.push(ev);
    if (this._inCoda) return;
    this._inCoda = true;
    setImmediate(() => this._svuota());
  }

  _svuota() {
    while (this._coda.length) {
      const ev = this._coda.shift();
      this.eventi.push(ev);
      if (typeof globalThis.__polpoNativo === "function") globalThis.__polpoNativo(ev.tipo === "usb.cambiati" ? JSON.stringify(ev) : ev);
    }
    this._inCoda = false;
  }

  _daChip(byte) {
    if (!this.porta || this.porta.ruolo !== "rom") return;
    for (let i = 0; i < byte.length; i += this.pezzo) this.emetti({ tipo: "seriale.dati", dati: b64(byte.subarray(i, i + this.pezzo)) });
  }

  // ---- bus USB ----

  stacca(voce) {
    this.dispositivi = this.dispositivi.filter((d) => d !== voce);
    if (this.porta === voce) {
      this.porta = null;
      this.emetti({ tipo: "seriale.chiusa", motivo: "scollegato" });
    }
    this.emetti({ tipo: "usb.cambiati" });
  }

  attacca(voce) {
    this.dispositivi.push(voce);
    this.emetti({ tipo: "usb.cambiati" });
  }

  /** Il Polpo (col firmware o nella ROM), se è collegato. */
  voce() {
    return this.dispositivi.find((d) => d.ruolo === "app" || d.ruolo === "rom") || null;
  }

  _riavviato(modo) {
    const vecchia = this.voce();
    setTimeout(() => {
      if (vecchia) this.stacca(vecchia);
      setTimeout(() => this.attacca(this._voce(modo === "rom" ? "rom" : "app")), this.ritardi.ricomparsa);
    }, this.ritardi.stacco);
  }

  // ---- PolpoNativo (android/PONTE.md) ----

  versione() {
    return "0.5.0";
  }

  usbElenco() {
    this.chiamateElenco++;
    return JSON.stringify(this.dispositivi.map(({ ruolo, ...d }) => d));
  }

  serialeElenco() {
    return JSON.stringify(this.dispositivi.map(({ ruolo, ...d }) => d).filter((d) => d.seriale));
  }

  risorsaBase64(percorso) {
    this.registro.push({ chiamata: "risorsaBase64", percorso });
    const r = this.risorse[percorso];
    return r ? b64(r) : "";
  }

  serialeApri(id, opzioni) {
    const o = opzioni ? JSON.parse(opzioni) : {};
    this.registro.push({ chiamata: "serialeApri", id, opzioni: o });
    const baud = o.baud ?? 115200;
    const voce = this.dispositivi.find((d) => d.id === id);
    if (baud === 1200) return this.emetti({ tipo: "seriale.errore", messaggio: "1200 baud non ammesso" });
    if (!voce || !voce.seriale) return this.emetti({ tipo: "seriale.errore", messaggio: "Dispositivo non trovato" });
    if (this.porta) this.serialeChiudi();
    this.porta = voce;
    voce.permesso = true;
    if (voce.ruolo === "rom") this.esp.impostaLinee(o.dtr ?? true, o.rts ?? false);
    this.emetti({ tipo: "seriale.aperta", nome: voce.nome });
  }

  serialeScrivi(base64) {
    if (!this.porta) return false;
    const dati = new Uint8Array(Buffer.from(base64, "base64"));
    const ultimo = this.registro.at(-1);
    if (ultimo && ultimo.chiamata === "serialeScrivi") ultimo.byte += dati.length;
    else this.registro.push({ chiamata: "serialeScrivi", byte: dati.length });
    if (this.porta.ruolo === "rom") {
      const esp = this.esp;
      setImmediate(() => esp.ricevi(dati));
    }
    return true;
  }

  serialeLinee(dtr, rts) {
    this.registro.push({ chiamata: "serialeLinee", dtr, rts });
    if (!this.porta) return false;
    if (this.porta.ruolo === "rom") this.esp.impostaLinee(dtr, rts);
    return true;
  }

  serialeBaud(baud) {
    this.registro.push({ chiamata: "serialeBaud", baud });
    return !!this.porta && baud !== 1200;
  }

  serialeToccoBootloader(id) {
    this.registro.push({ chiamata: "serialeToccoBootloader", id });
    const voce = this.dispositivi.find((d) => d.id === id);
    if (!voce) return this.emetti({ tipo: "seriale.tocco", ok: false, messaggio: "Dispositivo non trovato" });
    if (this.toccoRifiutato) return this.emetti({ tipo: "seriale.tocco", ok: false, messaggio: "Permesso USB negato" });
    if (this.porta === voce) this.serialeChiudi();
    this.emetti({ tipo: "seriale.tocco", ok: true, messaggio: "" });
    if (voce.ruolo !== "app") return; // la ROM ignora i 1200 baud
    if (this.dopoTocco === "bootloader") {
      this.esp.toccoA1200(); // riparte nella ROM: _riavviato stacca e riattacca
    } else if (this.dopoTocco === "sparisce") {
      setTimeout(() => this.stacca(voce), this.ritardi.stacco);
    }
  }

  serialeChiudi() {
    this.registro.push({ chiamata: "serialeChiudi" });
    if (!this.porta) return;
    this.porta = null;
    this.emetti({ tipo: "seriale.chiusa", motivo: "porta chiusa" });
  }
}
