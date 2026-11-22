// Polpo Studio nell'app per Android: collegamento al Polpo (cavo USB o Polpo virtuale) e moduli.
// Le regole sono quelle del programma per PC: conferme sullo schermo del Polpo, modalità laboratorio per trasmettere
// e scrivere, stati delle funzioni sempre a parole, niente di finto presentato come vero.

import { CATALOGO } from "./catalogo-dati.js";
import { presenze, valuta, nomiHardware, funzione } from "./catalogo.js";
import { ClientLink, ErroreLink, STATO as LINK } from "./link/client.js";
import { TrasportoVirtuale, TrasportoAndroid, TrasportoWebSerial, dispositiviAndroid, ascoltaNativo } from "./link/trasporti.js";
import { PolpoVirtuale } from "./virtuale.js";
import { Registro } from "./registro.js";
import { h, distintivo, sostituisci } from "./ui.js";
import { salvaFile } from "../salva.js";
import * as moduloPolpo from "./moduli/polpo.js";
import * as moduloScript from "./moduli/script.js";
import * as moduloIr from "./moduli/infrarossi.js";
import * as moduloRadio from "./moduli/radio.js";
import * as moduloNfc from "./moduli/nfc.js";
import * as moduloGpio from "./moduli/gpio.js";
import * as moduloArchivio from "./moduli/archivio.js";
import * as moduloSicurezza from "./moduli/sicurezza.js";
import * as moduloAttivita from "./moduli/attivita.js";
import * as moduloImpostazioni from "./moduli/impostazioni.js";
import * as moduloFunzioni from "./moduli/funzioni.js";

const $ = (id) => document.getElementById(id);
const CHIAVE_IMPOSTAZIONI = "polpo-studio-impostazioni-v1";
const nomi = nomiHardware(CATALOGO);

function leggiImpostazioni() {
  const base = { dichiarati: {}, intervalloPing: 10, minutiLaboratorio: 30, bloccoMinuti: 10 };
  try { return { ...base, ...JSON.parse(localStorage.getItem(CHIAVE_IMPOSTAZIONI) || "{}") }; } catch { return base; }
}

/** Tutto ciò che i moduli condividono. */
const ctx = {
  catalogo: CATALOGO,
  client: null,
  info: {},
  simulato: false,
  virtuale: null,
  registro: new Registro(),
  impostazioni: leggiImpostazioni(),
  hw: {},
  cassaforte: null, // impostata dal modulo Sicurezza quando è aperta
  laboratorio: null, // idem
  _schede: [],
  _eventi: new Map(),
  _aggiornamenti: [],

  collegato() {
    return !!this.client && this.client.stato === LINK.COLLEGATO;
  },

  valuta(id) {
    const f = funzione(CATALOGO, id);
    return f ? valuta(f, this.hw, nomi) : { stato: "non_disponibile", motivo: "funzione sconosciuta", usabile: false };
  },

  /** Un comando al Polpo collegato. */
  richiesta(cmd, args = null, tempo) {
    if (!this.collegato()) return Promise.reject(new ErroreLink("not_connected", "Collega prima un Polpo."));
    return this.client.richiesta(cmd, args, tempo);
  },

  suEvento(nome, fn) {
    if (!this._eventi.has(nome)) this._eventi.set(nome, new Set());
    this._eventi.get(nome).add(fn);
  },

  /** Da chiamare quando cambia qualcosa che conta per gli stati (collegamento, impostazioni, cassaforte). */
  suAggiornamento(fn) {
    this._aggiornamenti.push(fn);
  },

  aggiorna() {
    this.hw = presenze({
      polpo: this.collegato() ? { simulato: this.simulato, moduli: this.info.modules || {} } : null,
      dichiarati: this.impostazioni.dichiarati,
      catalogo: CATALOGO,
    });
    for (const s of this._schede) aggiornaScheda(s);
    for (const f of this._aggiornamenti) { try { f(); } catch (e) { console.error(e); } }
  },

  /** Rilegge le informazioni del Polpo (moduli collegati, batteria): gli stati delle funzioni seguono. */
  async aggiornaInfo() {
    if (!this.collegato()) return;
    try {
      this.info = { ...this.info, ...(await this.client.richiesta("info")) };
      this.aggiorna();
    } catch { /* il prossimo giro riprova */ }
  },

  salvaImpostazioni() {
    try { localStorage.setItem(CHIAVE_IMPOSTAZIONI, JSON.stringify(this.impostazioni)); } catch { /* senza memoria */ }
    this.aggiorna();
  },

  /** Un riquadro per una funzione del catalogo: titolo, stato a parole, motivo e i comandi (disattivati se non usabile). */
  scheda(idFunzione, ...contenuto) {
    const f = funzione(CATALOGO, idFunzione);
    const badge = h("span"), motivo = h("p", { class: "small st-motivo" });
    const campo = h("fieldset", { class: "st-campo" }, h("legend", { class: "sr" }, f ? f.titolo : idFunzione), ...contenuto);
    const el = h("article", { class: "card st-funz", dataset: { funzione: idFunzione } },
      h("h3", {}, f ? f.titolo : idFunzione, " ", badge), f ? h("p", { class: "small" }, f.descrizione) : null, motivo, campo);
    const s = { id: idFunzione, el, badge, motivo, campo };
    this._schede.push(s);
    aggiornaScheda(s);
    return el;
  },

  /** Messaggio per chi usa l'app (e nel registro, se serve). */
  avvisa(testo, livello = "info", categoria = null) {
    const a = $("st-avviso");
    a.textContent = testo;
    a.className = "small st-avviso " + livello;
    if (categoria) this.registro.aggiungi(categoria, testo, livello, this.simulato);
  },

  /** Testo chiaro per un errore del Polpo o del collegamento. */
  testoErrore(e) {
    if (!(e instanceof ErroreLink)) return e && e.message ? e.message : String(e);
    switch (e.codice) {
      case "denied": return "Rifiutato sullo schermo del Polpo.";
      case "timeout": return "Il Polpo non ha risposto in tempo.";
      case "not_connected": return "Il collegamento non è attivo: collega il Polpo e accetta sul suo schermo.";
      case "closed": return "Polpo non collegato.";
      case "budget": return `Limite di trasmissione raggiunto: ${e.message}`;
      default: return e.message;
    }
  },

  salvaFile,
};
window.__studio = ctx; // punto d'appoggio per le prove automatiche

function aggiornaScheda(s) {
  const v = ctx.valuta(s.id);
  sostituisci(s.badge, distintivo(v.stato));
  s.motivo.textContent = v.motivo;
  s.campo.disabled = !v.usabile;
  s.el.dataset.stato = v.stato;
}

// ---------------- collegamento ----------------

const statoEl = $("st-stato");
function mostraStato() {
  const c = ctx.client;
  const tipo = ctx.simulato ? "Polpo virtuale (SIMULATO)" : "Polpo vero";
  let testo = "Nessun Polpo collegato.";
  if (c) {
    if (c.stato === LINK.APERTO) testo = `${tipo}: porta aperta, collegamento non attivo.`;
    if (c.stato === LINK.ATTESA) testo = `${tipo}: accetta il collegamento sullo schermo del Polpo (scegli «Sì»).`;
    if (c.stato === LINK.COLLEGATO) {
      testo = `Collegato al ${tipo} · firmware ${ctx.info.firmware || "?"}`;
      if (!c.risponde) testo += " · non risponde";
    }
  }
  statoEl.textContent = testo;
  statoEl.dataset.stato = c ? c.stato : "chiuso";
  $("st-scollega").hidden = !c;
  $("st-collega").textContent = c && c.stato === LINK.APERTO ? "Ricollega" : "Collega un Polpo";
  $("st-collega").hidden = !!c && c.stato !== LINK.APERTO;
}

async function collegaCon(trasporto) {
  if (ctx.client) await scollega(false);
  ctx.simulato = !!trasporto.simulato;
  const c = new ClientLink(trasporto, {
    intervalloPing: ctx.impostazioni.intervalloPing * 1000,
    suEvento: (ev, dati) => { for (const f of ctx._eventi.get(ev) || []) f(dati); },
    suStato: (stato, perche) => {
      if (stato === LINK.CHIUSO && ctx.client === c) {
        ctx.client = null;
        ctx.registro.aggiungi("polpo", `Collegamento chiuso: ${perche}.`, "avviso", ctx.simulato);
      }
      if (stato === LINK.APERTO && perche === "chiuso sul Polpo") ctx.avvisa("Il Polpo ha chiuso il collegamento.", "avviso", "polpo");
      mostraStato();
      ctx.aggiorna();
    },
  });
  ctx.client = c;
  $("st-scelta").hidden = true;
  try {
    await c.apri();
    await c.sonda();
    await stretta();
  } catch (e) {
    ctx.avvisa(ctx.testoErrore(e), "errore", "polpo");
    if (c.stato !== LINK.APERTO) await scollega(false);
  }
}

/** Chiede il collegamento (conferma sul Polpo) e legge le informazioni. */
async function stretta() {
  const c = ctx.client;
  ctx.avvisa("Sullo schermo del Polpo scegli «Sì» per accettare il collegamento.");
  ctx.info = await c.hello();
  ctx.registro.aggiungi("polpo", `Collegato al ${ctx.simulato ? "Polpo virtuale" : "Polpo"} (firmware ${ctx.info.firmware}).`, "ok", ctx.simulato);
  ctx.avvisa("Collegato.", "ok");
  mostraStato();
  ctx.aggiorna();
}

async function scollega(inviaBye = true) {
  const c = ctx.client;
  ctx.client = null;
  ctx.info = {};
  if (c) { try { await c.chiudi(inviaBye); } catch { /* già chiuso */ } }
  mostraStato();
  ctx.aggiorna();
}

function elencoUsb() {
  const lista = $("st-usb");
  const nativo = globalThis.PolpoNativo;
  if (!nativo || !nativo.serialeElenco) {
    sostituisci(lista, h("li", { class: "small" }, "Il cavo USB si usa dall'app per Android."));
    $("st-usb-cerca").hidden = true;
    $("st-webserial").hidden = !("serial" in navigator);
    return;
  }
  const d = dispositiviAndroid();
  if (!d.length) {
    sostituisci(lista, h("li", { class: "small" }, "Nessun dispositivo USB trovato. Controlla il cavo OTG e che il Cardputer sia acceso."));
    return;
  }
  sostituisci(lista, d.map((x) => h("li", {},
    h("span", {}, `${x.nome}${x.polpo ? " (Espressif: probabilmente un Polpo)" : ""}`), " ",
    h("button", { type: "button", class: "btn btn-ghost", onclick: () => collegaCon(new TrasportoAndroid(x)) }, "Collega"))));
}

async function avviaVirtuale() {
  $("st-virt").hidden = false;
  if (!ctx.virtuale) {
    ctx.avvisa("Accendo il Polpo virtuale…");
    const v = new PolpoVirtuale($("st-schermo"));
    try {
      await v.accendi(new URL("../simulatore/", document.baseURI));
    } catch (e) {
      ctx.avvisa("Non riesco ad avviare il Polpo virtuale.", "errore");
      console.error(e);
      return;
    }
    ctx.virtuale = v;
    v.mondo({ cmd: "modulo", valore: $("st-grove").value });
  }
  await collegaCon(new TrasportoVirtuale(ctx.virtuale.polpo, { avanzaDaSe: false }));
}

$("st-collega").addEventListener("click", () => {
  if (ctx.client && ctx.client.stato === LINK.APERTO) {
    stretta().catch((e) => ctx.avvisa(ctx.testoErrore(e), "errore", "polpo"));
    return;
  }
  $("st-scelta").hidden = !$("st-scelta").hidden;
  elencoUsb();
});
$("st-scollega").addEventListener("click", () => scollega(true));
$("st-usb-cerca").addEventListener("click", elencoUsb);
$("st-virtuale").addEventListener("click", avviaVirtuale);
$("st-webserial").addEventListener("click", async () => {
  try {
    const porta = await navigator.serial.requestPort();
    await collegaCon(new TrasportoWebSerial(porta));
  } catch { /* nessuna porta scelta */ }
});
ascoltaNativo((ev) => { if (ev.tipo === "usb.cambiati" && !$("st-scelta").hidden) elencoUsb(); });

// tasti e mondo del Polpo virtuale
document.querySelectorAll("[data-tasto]").forEach((b) => b.addEventListener("click", () => ctx.virtuale && ctx.virtuale.premi(b.dataset.tasto)));
$("st-grove").addEventListener("change", (e) => {
  if (!ctx.virtuale) return;
  ctx.virtuale.mondo({ cmd: "modulo", valore: e.target.value });
  ctx.avvisa(`Polpo virtuale: porta Grove con ${e.target.selectedOptions[0].textContent}.`);
  setTimeout(() => ctx.aggiornaInfo(), 300); // il Polpo se ne accorge al prossimo controllo del bus I2C
});
// i moduli sulla porta Grove si possono collegare e staccare in ogni momento: ogni tanto si ricontrolla
setInterval(() => { if (ctx.collegato() && ctx.client.risponde) ctx.aggiornaInfo(); }, 20000);
$("st-tag").addEventListener("change", (e) => {
  if (!ctx.virtuale) return;
  ctx.virtuale.mondo({ cmd: "tag", tipo: e.target.value || "ntag213", vicino: !!e.target.value });
});
document.querySelectorAll("[data-rf]").forEach((b) => b.addEventListener("click", () => {
  const r = ctx.virtuale && ctx.virtuale.mondo({ cmd: "radiocomando", valore: Number(b.dataset.rf), bit: 24 });
  if (r && r.ok === false) ctx.avvisa(`Non succede nulla: ${r.errore}.`, "avviso");
}));
document.querySelectorAll("[data-ir]").forEach((b) => b.addEventListener("click", () => {
  const r = ctx.virtuale && ctx.virtuale.mondo({ cmd: "telecomando", protocollo: "NEC", indirizzo: 4, comando: Number(b.dataset.ir) });
  if (r && r.ok === false) ctx.avvisa(`Non succede nulla: ${r.errore}.`, "avviso");
}));

// ---------------- moduli ----------------

const MODULI = [moduloPolpo, moduloScript, moduloIr, moduloRadio, moduloNfc, moduloGpio, moduloArchivio, moduloSicurezza, moduloAttivita, moduloImpostazioni, moduloFunzioni];
const schede = $("st-schede"), contenitore = $("st-moduli");
const istanze = [];
for (const m of MODULI) {
  const ist = m.crea(ctx);
  const sezione = h("section", { class: "st-modulo", id: "m-" + ist.id, "aria-labelledby": "t-" + ist.id, hidden: true },
    h("h2", { id: "t-" + ist.id }, ist.titolo), ist.el);
  contenitore.append(sezione);
  schede.append(h("a", { href: "#" + ist.id, class: "st-scheda", dataset: { modulo: ist.id } }, ist.titolo));
  istanze.push({ ...ist, sezione });
}

function mostraModulo() {
  const id = location.hash.slice(1) || "polpo";
  const scelto = istanze.find((i) => i.id === id) || istanze[0];
  for (const i of istanze) {
    i.sezione.hidden = i !== scelto;
    const link = schede.querySelector(`[data-modulo="${i.id}"]`);
    if (i === scelto) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
  }
  if (scelto.mostrato) scelto.mostrato();
}
addEventListener("hashchange", mostraModulo);
mostraModulo();
mostraStato();
ctx.aggiorna();
addEventListener("pagehide", () => { if (ctx.virtuale) ctx.virtuale.salva(); });
