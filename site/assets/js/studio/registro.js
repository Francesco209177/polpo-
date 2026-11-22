// Registro delle attività (copia di studio/polpo_studio/core/activity.py): le voci restano in memoria per la pagina e
// si salvano solo nel registro cifrato della cassaforte, quando è aperta. Quelle nate prima aspettano in memoria.

export const LIVELLI = ["info", "ok", "avviso", "errore"];

export class Registro {
  constructor(tieni = 2000) {
    this.tieni = tieni;
    this.voci = [];
    this._inAttesa = [];
    this._destinazione = null;
    this._ascoltatori = [];
  }

  /** Collega il registro cifrato: carica le voci passate e salva quelle in attesa. */
  collega(destinazione, storia = []) {
    const vecchie = storia.filter((d) => d && ["ts", "category", "message", "level", "simulated"].every((k) => k in d));
    this.voci = [...vecchie, ...this.voci].slice(-this.tieni);
    this._destinazione = destinazione;
    const attesa = this._inAttesa;
    this._inAttesa = [];
    for (const v of attesa) this._scrivi(v);
  }

  scollega() {
    this._destinazione = null;
    this.voci = [];
  }

  _scrivi(v) {
    if (!this._destinazione) { this._inAttesa.push(v); return; }
    Promise.resolve().then(() => this._destinazione(v)).catch((e) => console.warn("impossibile salvare nel registro", e));
  }

  aggiungi(categoria, messaggio, livello = "info", simulato = false) {
    const v = { ts: Date.now() / 1000, category: categoria, message: messaggio, level: LIVELLI.includes(livello) ? livello : "info", simulated: !!simulato };
    this.voci.push(v);
    if (this.voci.length > this.tieni) this.voci.shift();
    this._scrivi(v);
    for (const f of this._ascoltatori) f(v);
    return v;
  }

  suAggiunta(f) {
    this._ascoltatori.push(f);
  }
}
