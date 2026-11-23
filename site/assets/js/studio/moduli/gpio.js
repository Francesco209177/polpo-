// Modulo «GPIO»: i pin della porta Grove e la scansione del bus I2C dal Polpo; con il cavo OTG la console seriale,
// le schede collegate e il Polpo Bridge (Sperimentale); i calcolatori. Come in Polpo Studio per PC: le uscite del
// Bridge chiedono la modalità laboratorio (e una conferma per impostare un pin come uscita).
import { h, tabella, sostituisci, quando } from "../ui.js";
import { cassaforteAperta } from "../comune.js";
import { testoOhm, testoPartitore, testoLed, testoColori, NOTA_TENSIONI } from "../protocolli/elettronica.js";
import { PortaSeriale } from "../seriale.js";
import { TrasportoAndroid } from "../link/trasporti.js";
import {
  VELOCITA, VELOCITA_PREDEFINITA, vociFineRiga, FINE_RIGA_PREDEFINITA, opzioniApertura, datiDaInviare, Terminale,
  TESTI as TESTI_CONSOLE, messaggioAperta, salvataggioRegistro,
} from "../strumenti/console_seriale.js";
import { elencoTelefono, righeSchede, COLONNE as COLONNE_USB } from "../protocolli/schede_usb.js";
import {
  GestoreBridge, TESTI as TESTI_BRIDGE, MODI_PIN, testoInfo, preparaCollegamento, testoFallimento, vociPin, preparaModo,
  preparaLettura, preparaScrittura, preparaAdc, preparaI2c, eseguiAzione, conOra,
} from "../protocolli/bridge.js";

const ora = () => new Date().toTimeString().slice(0, 8);

/** Il cavo OTG porta una sola porta seriale per volta: il Polpo collegato via USB, la console o il Bridge. */
export function portaOtgOccupata(ctx, chi) {
  if (ctx.collegato() && !ctx.simulato) return "Il cavo USB è già usato dal Polpo: scollegalo prima (una porta per volta).";
  if (ctx.portaOtg && ctx.portaOtg !== chi) return `La porta USB è già aperta da: ${ctx.portaOtg}. Chiudila prima.`;
  return "";
}

/** Le porte seriali USB del telefono in un elenco a tendina; restituisce le porte. */
function riempiPorte(sel, porte) {
  sostituisci(sel, ...(porte.length
    ? porte.map((p, i) => h("option", { value: String(i) }, `${p.dispositivo}${p.chip ? " · " + p.chip : ""}`))
    : [h("option", { value: "" }, "Nessuna porta seriale USB collegata")]));
}

function elencoUsb() {
  const n = globalThis.PolpoNativo;
  if (!n || !n.usbElenco) return { dispositivi: [], porte: [], mancanti: [] };
  try { return elencoTelefono(JSON.parse(n.usbElenco())); } catch { return { dispositivi: [], porte: [], mancanti: [] }; }
}

/** Console seriale (gpio.console). */
function consoleSeriale(ctx) {
  const porta = new PortaSeriale();
  let porte = [];
  const termine = new Terminale();
  const sceltaPorta = h("select", { "aria-label": "Porta seriale" });
  const velocita = h("select", { "aria-label": "Velocità" }, ...VELOCITA.map((v) => h("option", { value: String(v), selected: v === VELOCITA_PREDEFINITA }, `${v} baud`)));
  const fineRiga = h("select", { "aria-label": "Fine riga" }, ...vociFineRiga().map(([n, k]) => h("option", { value: k, selected: k === FINE_RIGA_PREDEFINITA }, n)));
  const riavvia = h("input", { type: "checkbox", checked: true });
  const esa = h("input", { type: "checkbox" });
  const uscita = h("pre", { class: "st-log", "aria-live": "polite" });
  const testo = h("input", { type: "text", placeholder: TESTI_CONSOLE.segnaposto, "aria-label": "Testo da inviare" });
  const mostra = () => { uscita.textContent = termine.testo; uscita.scrollTop = uscita.scrollHeight; };
  const aggiornaPorte = () => { porte = elencoUsb().porte; riempiPorte(sceltaPorta, porte); };
  const apri = async () => {
    if (porta.aperta) { ctx.avvisa("La console è già aperta."); return; }
    const occupata = portaOtgOccupata(ctx, "console seriale");
    if (occupata) { ctx.avvisa(occupata, "errore"); return; }
    const p = porte[Number(sceltaPorta.value)];
    if (!p) { ctx.avvisa(TESTI_CONSOLE.nessunaPorta, "errore"); return; }
    let opz;
    try { opz = opzioniApertura(Number(velocita.value), riavvia.checked); } catch (e) { ctx.avvisa(e.message, "errore"); return; }
    try {
      ctx.portaOtg = "console seriale";
      await porta.apri({ id: p.id, nome: p.dispositivo }, opz, (d) => { termine.ricevi(d, esa.checked); mostra(); }, () => {
        ctx.portaOtg = null; ctx.avvisa(TESTI_CONSOLE.scollegata);
      });
      ctx.avvisa(messaggioAperta(p.dispositivo, opz.baud), "ok");
    } catch (e) { ctx.portaOtg = null; ctx.avvisa(e.message, "errore"); }
  };
  const chiudi = () => { if (porta.aperta) { porta.chiudi(); ctx.portaOtg = null; ctx.avvisa(TESTI_CONSOLE.chiusa); } };
  const invia = () => {
    if (!porta.aperta) { ctx.avvisa(TESTI_CONSOLE.apriPrima, "errore"); return; }
    let dati;
    try { dati = datiDaInviare(testo.value, fineRiga.value); } catch (e) { ctx.avvisa(e.message, "errore"); return; }
    if (!porta.scrivi(dati)) { ctx.avvisa(TESTI_CONSOLE.portaChiusa, "errore"); return; }
    testo.value = "";
  };
  testo.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); invia(); } });
  const salva = async () => {
    const s = salvataggioRegistro(termine.testo.trim() ? termine.testo : "", new Date());
    if (!s) { ctx.avvisa("La console è vuota."); return; }
    const c = cassaforteAperta(ctx);
    if (!c) return;
    try { await c.aggiungi(s.categoria, s.nome, s.dati); ctx.avvisa(s.messaggio, "ok"); } catch (e) { ctx.avvisa(ctx.testoErrore(e), "errore"); }
  };
  ctx.suAggiornamento(() => { if (!porta.aperta) aggiornaPorte(); });
  aggiornaPorte();
  return [
    h("p", { class: "small" }, "Una scheda o un adattatore USB-seriale collegato al telefono con il cavo OTG. 1200 baud non si usa: fa ripartire molte schede nel bootloader."),
    h("div", { class: "btn-row" }, sceltaPorta, velocita),
    h("div", { class: "btn-row" }, h("label", { class: "small" }, riavvia, " ", TESTI_CONSOLE.riavvia), h("label", { class: "small" }, esa, " ", TESTI_CONSOLE.esadecimale)),
    h("div", { class: "btn-row" },
      h("button", { type: "button", class: "btn btn-studio", onclick: apri }, "Apri"),
      h("button", { type: "button", class: "btn btn-ghost", onclick: chiudi }, "Chiudi"),
      h("button", { type: "button", class: "btn btn-ghost", onclick: () => { termine.svuota(); mostra(); } }, "Pulisci"),
      h("button", { type: "button", class: "btn btn-ghost", onclick: salva }, "Salva nella cassaforte")),
    uscita,
    h("div", { class: "btn-row" }, testo, fineRiga, h("button", { type: "button", class: "btn btn-ghost", onclick: invia }, "Invia")),
  ];
}

/** Schede collegate (gpio.boards): le porte seriali del telefono con chip e suggerimento. */
function schedeCollegate(ctx) {
  const out = h("div", { class: "st-tabella" });
  const disegna = () => {
    const { porte, mancanti } = elencoUsb();
    sostituisci(out,
      porte.length ? tabella(COLONNE_USB.schede || ["Porta", "Chip", "USB ID", "Descrizione", "Probabilmente"], righeSchede(porte)) : h("p", { class: "small" }, "Nessuna scheda collegata al telefono con il cavo OTG."),
      mancanti.length ? h("p", { class: "small" }, `${mancanti.length} dispositivi USB senza un driver seriale nel telefono.`) : null);
  };
  ctx.suAggiornamento(disegna);
  disegna();
  return [h("div", { class: "btn-row" }, h("button", { type: "button", class: "btn btn-ghost", onclick: disegna }, "Aggiorna")), out];
}

/** Polpo Bridge (gpio.bridge): collegamento, pin, ADC, I2C. Il gestore è condiviso con il modulo iButton (ctx.bridge). */
function polpoBridge(ctx) {
  const righe = [];
  const registroVista = h("pre", { class: "st-log", "aria-live": "polite" });
  const scrivi = (t) => { righe.push(conOra(t, ora())); if (righe.length > 300) righe.shift(); registroVista.textContent = righe.join("\n"); };
  const info = h("p", { class: "small" }, testoInfo({}));
  const sceltaPorta = h("select", { "aria-label": "Porta del Bridge" });
  const sceltaPin = h("select", { "aria-label": "Pin" });
  const sceltaModo = h("select", { "aria-label": "Modo del pin" }, ...MODI_PIN.map(([m, n]) => h("option", { value: m }, n)));
  let porte = [];
  const gestore = new GestoreBridge({
    registro: ctx.registro,
    suStato: ({ collegato, info: i }) => {
      info.textContent = testoInfo(i);
      sostituisci(sceltaPin, ...vociPin(i).map(([t, p]) => h("option", { value: String(p) }, t)));
      if (!collegato) { ctx.bridge = null; ctx.portaOtg = ctx.portaOtg === "Polpo Bridge" ? null : ctx.portaOtg; }
      ctx.aggiorna();
    },
  });
  const pinScelto = () => (sceltaPin.value === "" ? null : Number(sceltaPin.value));
  const aggiornaPorte = () => { porte = elencoUsb().porte; riempiPorte(sceltaPorta, porte); };
  const collega = async () => {
    const p = porte[Number(sceltaPorta.value)];
    const prep = preparaCollegamento(p ? p.dispositivo : "");
    if (prep.errore) { ctx.avvisa(prep.errore, "errore"); return; }
    const occupata = portaOtgOccupata(ctx, "Polpo Bridge");
    if (occupata) { ctx.avvisa(occupata, "errore"); return; }
    ctx.avvisa(prep.messaggio);
    ctx.portaOtg = "Polpo Bridge";
    try {
      await gestore.collega(new TrasportoAndroid({ id: p.id, nome: p.dispositivo }), p.dispositivo);
      ctx.bridge = { nome: p.dispositivo, gestore };
      ctx.aggiorna();
      ctx.avvisa(TESTI_BRIDGE.collegato, "ok");
    } catch (e) { ctx.portaOtg = null; ctx.avvisa(testoFallimento(e), "errore"); }
  };
  const scollega = async () => { await gestore.scollega(); ctx.bridge = null; ctx.portaOtg = null; ctx.aggiorna(); ctx.avvisa(TESTI_BRIDGE.scollegato); };
  const esegui = (a) => eseguiAzione(a, {
    gestore,
    laboratorio: ctx.laboratorio,
    conferma: async (titolo, testo) => confirm(`${titolo}\n\n${testo}`),
    avvisa: (t, errore) => ctx.avvisa(t, errore ? "errore" : "ok"),
    scrivi,
    registro: ctx.registro,
    categoria: "gpio",
  });
  ctx.suAggiornamento(() => { if (!gestore.collegato) aggiornaPorte(); });
  aggiornaPorte();
  const b = (t, fn) => h("button", { type: "button", class: "btn btn-ghost", onclick: fn }, t);
  // il collegamento sta fuori dalla scheda della funzione: la funzione è «disponibile» solo a Bridge collegato
  const collegamento = h("article", { class: "card st-funz", dataset: { pannello: "bridge" } },
    h("h3", {}, "Collegamento al Polpo Bridge ", h("span", { class: "badge exp" }, "Sperimentale")),
    h("p", { class: "small" }, "Una scheda Arduino o ESP32 con lo sketch Polpo Bridge (studio/bridge/polpo_bridge), collegata al telefono con il cavo OTG. ", TESTI_BRIDGE.tensioni),
    h("div", { class: "btn-row" }, sceltaPorta, h("button", { type: "button", class: "btn btn-studio", onclick: collega }, "Collega"), b("Scollega", scollega)),
    info);
  return { collegamento, comandi: [
    h("div", { class: "btn-row" }, sceltaPin, sceltaModo, b("Imposta modo", () => esegui(preparaModo(pinScelto(), sceltaModo.value)))),
    h("div", { class: "btn-row" },
      b("Leggi", () => esegui(preparaLettura(pinScelto()))),
      b("Uscita ALTA", () => esegui(preparaScrittura(pinScelto(), 1))),
      b("Uscita BASSA", () => esegui(preparaScrittura(pinScelto(), 0))),
      b("Leggi ADC", () => esegui(preparaAdc(pinScelto()))),
      b("Scansione I2C", () => esegui(preparaI2c()))),
    registroVista,
  ] };
}

/** I calcolatori di elettronica (legge di Ohm, partitore, LED, codice colori), come in Polpo Studio per PC. */
function calcolatori() {
  const num = (etichetta, valore) => h("input", { type: "number", step: "any", value: String(valore), "aria-label": etichetta });
  const blocco = (titolo, campi, calcola) => {
    const uscita = h("p", { class: "st-risultato" });
    const aggiorna = () => { uscita.textContent = calcola(...campi.map(([, el]) => (el.type === "number" ? Number(el.value) || 0 : el.value))); };
    for (const [, el] of campi) el.addEventListener("input", aggiorna);
    aggiorna();
    return h("details", { class: "st-app" }, h("summary", {}, titolo), h("div", { class: "st-campi" }, campi.map(([t, el]) => h("label", {}, t, " ", el))), uscita);
  };
  return [
    blocco("Legge di Ohm (lascia a 0 il valore da calcolare)", [["Tensione (V)", num("Tensione", 5)], ["Corrente (A)", num("Corrente", 0)], ["Resistenza (Ω)", num("Resistenza", 220)]], testoOhm),
    blocco("Partitore di tensione", [["Vin (V)", num("Vin", 5)], ["R1 (Ω)", num("R1", 10000)], ["R2 (Ω)", num("R2", 10000)]], testoPartitore),
    blocco("Resistenza per un LED", [["Alimentazione (V)", num("Alimentazione", 5)], ["Tensione del LED (V)", num("Tensione LED", 2)], ["Corrente (mA)", num("Corrente LED", 15)]], testoLed),
    blocco("Codice colori delle resistenze", [["Colori", h("input", { type: "text", value: "giallo viola rosso oro", "aria-label": "Colori" })], ["oppure valore (Ω)", h("input", { type: "text", value: "4700", "aria-label": "Valore in ohm" })]], testoColori),
    h("p", { class: "small" }, NOTA_TENSIONI),
  ];
}

export function crea(ctx) {
  const pinOut = h("ul", { class: "st-righe" }), i2cOut = h("div");
  const pin = async () => {
    try {
      const d = await ctx.richiesta("gpio.pins");
      pinOut.prepend(h("li", {}, `${quando()} · G1 = ${d.g1} · G2 = ${d.g2}${ctx.simulato ? " (SIMULATO)" : ""}`));
    } catch (e) { ctx.avvisa(ctx.testoErrore(e), "errore"); }
  };
  const i2c = async () => {
    try {
      const d = await ctx.richiesta("gpio.i2c_scan");
      const n = d.devices || [];
      sostituisci(i2cOut, n.length ? tabella(["Indirizzo", "Probabilmente"], n.map((x) => ["0x" + x.addr.toString(16).padStart(2, "0"), x.name || "?"]))
        : h("p", { class: "small" }, "Nessun dispositivo sul bus I2C."));
    } catch (e) { ctx.avvisa(ctx.testoErrore(e), "errore"); }
  };
  const bridge = polpoBridge(ctx);
  const el = h("div", { class: "st-griglia" },
    ctx.scheda("gpio.grove",
      h("p", { class: "small" }, "Lettura dei pin G1 e G2 della porta Grove (solo lettura) e ricerca dei moduli I2C collegati."),
      h("div", { class: "btn-row" },
        h("button", { type: "button", class: "btn btn-ghost", onclick: pin }, "Leggi i pin"),
        h("button", { type: "button", class: "btn btn-ghost", onclick: i2c }, "Cerca sul bus I2C")),
      pinOut, i2cOut),
    ctx.scheda("gpio.calc", ...calcolatori()),
    ctx.scheda("gpio.console", ...consoleSeriale(ctx)),
    ctx.scheda("gpio.boards", ...schedeCollegate(ctx)),
    bridge.collegamento,
    ctx.scheda("gpio.bridge", ...bridge.comandi),
    ctx.scheda("gpio.flash"),
  );
  return { id: "gpio", titolo: "GPIO", el };
}
