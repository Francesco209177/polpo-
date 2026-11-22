// Modulo «Impostazioni»: hardware dichiarato (ciò che il Polpo non può rilevare da solo) e collegamento.
import { h } from "../ui.js";

export function crea(ctx) {
  const dichiarabili = ctx.catalogo.hardware.filter((x) => x.dichiarabile && x.id.startsWith("polpo."));
  const voci = dichiarabili.map((x) => {
    const c = h("input", { type: "checkbox", checked: !!ctx.impostazioni.dichiarati[x.id] });
    c.addEventListener("change", () => {
      ctx.impostazioni.dichiarati = { ...ctx.impostazioni.dichiarati, [x.id]: c.checked };
      ctx.salvaImpostazioni();
      ctx.avvisa(`${x.nome}: ${c.checked ? "dichiarato collegato" : "non più dichiarato"}.`, "info", "sistema");
    });
    return h("li", {}, h("label", { class: "sim-spunta" }, c, " ", x.nome), h("p", { class: "small" }, x.come));
  });
  const ping = h("input", { type: "number", min: "3", max: "60", value: String(ctx.impostazioni.intervalloPing) });
  ping.addEventListener("change", () => {
    const v = Math.min(60, Math.max(3, Number(ping.value) || 10));
    ping.value = String(v);
    ctx.impostazioni.intervalloPing = v;
    ctx.salvaImpostazioni();
  });
  const el = h("div", { class: "st-griglia" },
    h("article", { class: "card" }, h("h3", {}, "Hardware"),
      h("p", { class: "small" }, "Il Polpo non può accorgersi da solo di questi moduli sulla porta Grove. Se li hai collegati, dichiaralo: le funzioni che li usano diventano utilizzabili."),
      h("ul", { class: "st-righe" }, voci)),
    h("article", { class: "card" }, h("h3", {}, "Collegamento"),
      h("label", {}, "Controllo che il Polpo risponda ogni ", ping, " secondi"),
      h("p", { class: "small" }, "Vale dal prossimo collegamento.")),
    h("article", { class: "card" }, h("h3", {}, "Aspetto"),
      h("p", { class: "small" }, "Chiaro o scuro segue il tema del telefono (Impostazioni di Android › Display).")),
  );
  return { id: "impostazioni", titolo: "Impostazioni", el };
}
