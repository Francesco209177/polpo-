// Modulo «GPIO»: i pin della porta Grove e la scansione del bus I2C, dal Polpo. Il resto (console seriale, schede,
// Polpo Bridge, calcolatori) arriverà nell'app più avanti.
import { h, tabella, sostituisci, quando } from "../ui.js";

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
    ...["gpio.console", "gpio.boards", "gpio.flash", "gpio.calc", "gpio.bridge"].map((id) => ctx.scheda(id)),
  );
  return { id: "gpio", titolo: "GPIO", el };
}
