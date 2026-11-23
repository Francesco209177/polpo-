// Una porta seriale USB generica (cavo OTG), per ciò che non è il Polpo: lettore RDM6300, console seriale, Polpo
// Bridge. Passa dal ponte dell'app (android/PONTE.md). Una porta per volta: se il Polpo è collegato con il cavo, va
// scollegato prima.
import { ascoltaNativo, dispositiviAndroid } from "./link/trasporti.js";
import { base64, daBase64 } from "./link/proto.js";

export class PortaSeriale {
  constructor(nativo = globalThis.PolpoNativo) {
    this.nativo = nativo;
    this.aperta = false;
    this.nome = "";
    this._smetti = null;
  }

  /** Apre `dispositivo` ({id, nome}) a `baud`; `suDati(Uint8Array)` riceve ciò che arriva, `suChiusura(motivo)` la fine. */
  apri(dispositivo, { baud = 115200, dtr = true, rts = false } = {}, suDati = () => {}, suChiusura = () => {}) {
    if (!this.nativo || !this.nativo.serialeApri) return Promise.reject(new Error("La porta seriale USB si usa dall'app per Android."));
    return new Promise((risolvi, rifiuta) => {
      let attesa = true;
      this._smetti = ascoltaNativo((ev) => {
        if (ev.tipo === "seriale.aperta" && attesa) { attesa = false; this.aperta = true; this.nome = dispositivo.nome || ev.nome || ""; risolvi(); }
        else if (ev.tipo === "seriale.errore" && attesa) { attesa = false; this._fine(); rifiuta(new Error(ev.messaggio || "porta non aperta")); }
        else if (ev.tipo === "seriale.dati" && this.aperta) { const d = daBase64(ev.dati || ""); if (d) suDati(d); }
        else if (ev.tipo === "seriale.chiusa" && this.aperta) { this.aperta = false; this._fine(); suChiusura(ev.motivo || "porta chiusa"); }
      });
      this.nativo.serialeApri(String(dispositivo.id), JSON.stringify({ baud, dtr, rts }));
    });
  }

  scrivi(dati) {
    if (!this.aperta) return false;
    return !!this.nativo.serialeScrivi(base64(typeof dati === "string" ? new TextEncoder().encode(dati) : dati));
  }

  chiudi() {
    if (this.aperta) { this.aperta = false; try { this.nativo.serialeChiudi(); } catch { /* già chiusa */ } }
    this._fine();
  }

  _fine() {
    if (this._smetti) this._smetti();
    this._smetti = null;
  }
}

/** Un elenco a tendina con le porte seriali USB collegate al telefono. */
export function opzioniPorte(seleziona) {
  const porte = dispositiviAndroid();
  seleziona.replaceChildren(...(porte.length
    ? porte.map((p) => Object.assign(document.createElement("option"), { value: String(p.id), textContent: `${p.nome}${p.produttore ? ` · ${p.produttore}` : ""}` }))
    : [Object.assign(document.createElement("option"), { value: "", textContent: "Nessuna porta seriale USB collegata" })]));
  return porte;
}
