// Il Polpo virtuale di Studio: il firmware vero (simulatore/firmware.js) con il suo schermo, i tasti per accettare le
// richieste e un piccolo «mondo» attorno (modulo sulla porta Grove, telecomandi, tag). È lo stesso Polpo del
// simulatore del sito: stessa microSD e stesse impostazioni, salvate nel telefono. Tutto è SIMULATO.

import { creaPolpo, postoDelTasto, LARGHEZZA, ALTEZZA } from "../simulatore/firmware.js";
import { caricaFirmware } from "../simulatore/carica.js";

const CHIAVE = "polpo-simulatore-firmware-v1"; // la stessa del simulatore
const DA5 = Uint8Array.from({ length: 32 }, (_, i) => Math.round((i * 255) / 31));
const DA6 = Uint8Array.from({ length: 64 }, (_, i) => Math.round((i * 255) / 63));

const inBase64 = (b) => { let s = ""; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192)); return btoa(s); };
const daBase64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export class PolpoVirtuale {
  /** @param {HTMLCanvasElement} tela  dove disegnare lo schermo */
  constructor(tela) {
    this.tela = tela;
    this.g = tela.getContext("2d");
    this.immagine = this.g.createImageData(LARGHEZZA, ALTEZZA);
    this.polpo = null;
    this._impronta = -1;
    this._tasti = []; // {fila, colonna, rilascia: ora del firmware}
    this._salvato = "";
    this._acceso = false;
    this._ultimo = 0;
    this.suEvento = null;
  }

  /** Carica il firmware (dalla cartella del simulatore) e lo accende. */
  async accendi(baseSimulatore) {
    const modulo = await caricaFirmware(baseSimulatore);
    this.polpo = await creaPolpo(modulo);
    try {
      const s = localStorage.getItem(CHIAVE);
      if (s && this.polpo.statoImporta(daBase64(s))) this._salvato = s;
    } catch { /* senza memoria si parte da zero */ }
    this.polpo.mondo({ cmd: "pc", collegato: true });
    this.polpo.avvia();
    this._acceso = true;
    this._ultimo = performance.now();
    const ciclo = (adesso) => {
      if (!this._acceso) return;
      this.passo(adesso);
      requestAnimationFrame(ciclo);
    };
    requestAnimationFrame(ciclo);
    // anche a schermo spento o con la pagina nascosta il firmware deve rispondere: un orologio di riserva
    this._riserva = setInterval(() => { if (performance.now() - this._ultimo > 250) this.passo(performance.now()); }, 250);
    this._salva = setInterval(() => this.salva(), 3000);
    return this.polpo;
  }

  passo(adesso) {
    const dt = Math.min(200, Math.max(0, adesso - this._ultimo));
    this._ultimo = adesso;
    this.polpo.avanza(dt);
    const ora = this.polpo.ora();
    this._tasti = this._tasti.filter((t) => {
      if (ora < t.rilascia) return true;
      this.polpo.tasto(t.fila, t.colonna, false);
      return false;
    });
    for (let e; (e = this.polpo.evento()) !== null; ) if (this.suEvento) this.suEvento(e);
    this.disegna();
  }

  disegna() {
    const ora = this.polpo.impronta();
    if (ora === this._impronta) return;
    this._impronta = ora;
    const b = this.polpo.schermo(), px = this.immagine.data;
    for (let i = 0, o = 0; i < LARGHEZZA * ALTEZZA; i++, o += 4) {
      const v = (b[2 * i] << 8) | b[2 * i + 1];
      px[o] = DA5[v >> 11];
      px[o + 1] = DA6[(v >> 5) & 63];
      px[o + 2] = DA5[v & 31];
      px[o + 3] = 255;
    }
    this.g.putImageData(this.immagine, 0, 0);
  }

  /** Preme un tasto per nome («ok», «su», «giu», «sinistra», «destra», «indietro»…) e lo rilascia dopo 80 ms del firmware. */
  premi(nome) {
    if (!this.polpo) return;
    if (nome === "g0") { this.polpo.g0(); return; }
    const t = postoDelTasto(nome);
    if (!t) return;
    this.polpo.tasto(t.fila, t.colonna, true);
    this._tasti.push({ fila: t.fila, colonna: t.colonna, rilascia: this.polpo.ora() + 80 });
  }

  mondo(comando) {
    return this.polpo ? this.polpo.mondo(comando) : { ok: false, errore: "Polpo virtuale spento" };
  }

  salva() {
    if (!this.polpo) return;
    try {
      const testo = inBase64(this.polpo.statoEsporta());
      if (testo !== this._salvato) { localStorage.setItem(CHIAVE, testo); this._salvato = testo; }
    } catch { /* memoria piena o assente: si va avanti senza ricordare */ }
  }

  spegni() {
    this.salva();
    this._acceso = false;
    clearInterval(this._riserva);
    clearInterval(this._salva);
  }
}
