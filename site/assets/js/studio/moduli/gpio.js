// Modulo «GPIO»: i pin della porta Grove e la scansione del bus I2C, dal Polpo. Il resto (console seriale, schede,
// Polpo Bridge, calcolatori) arriverà nell'app più avanti.
import { h, tabella, sostituisci, quando } from "../ui.js";
import { testoOhm, testoPartitore, testoLed, testoColori, NOTA_TENSIONI } from "../protocolli/elettronica.js";

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
  const el = h("div", { class: "st-griglia" },
    ctx.scheda("gpio.grove",
      h("p", { class: "small" }, "Lettura dei pin G1 e G2 della porta Grove (solo lettura) e ricerca dei moduli I2C collegati."),
      h("div", { class: "btn-row" },
        h("button", { type: "button", class: "btn btn-ghost", onclick: pin }, "Leggi i pin"),
        h("button", { type: "button", class: "btn btn-ghost", onclick: i2c }, "Cerca sul bus I2C")),
      pinOut, i2cOut),
    ctx.scheda("gpio.calc", ...calcolatori()),
    ...["gpio.console", "gpio.boards", "gpio.flash", "gpio.bridge"].map((id) => ctx.scheda(id)),
  );
  return { id: "gpio", titolo: "GPIO", el };
}
