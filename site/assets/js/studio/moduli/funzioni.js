// Modulo «Tutte le funzioni»: il catalogo di Polpo Studio con lo stato di ogni funzione nel telefono, dal vivo.
import { h, distintivo, sostituisci } from "../ui.js";
import { STATO } from "../catalogo.js";

export function crea(ctx) {
  const corpo = h("div");
  const filtro = h("select", { "aria-label": "Mostra" },
    h("option", { value: "" }, "Tutte"), h("option", { value: "usabili" }, "Solo quelle che puoi usare ora"));
  const disegna = () => {
    const soloUsabili = filtro.value === "usabili";
    const conteggio = {};
    const blocchi = ctx.catalogo.moduli.map((m) => {
      const righe = m.funzioni.map((f) => {
        const v = ctx.valuta(f.id);
        conteggio[v.stato] = (conteggio[v.stato] || 0) + 1;
        if (soloUsabili && !v.usabile) return null;
        return h("li", { dataset: { funzione: f.id, stato: v.stato } }, h("strong", {}, f.titolo), " ", distintivo(v.stato),
          f.laboratorio ? h("span", { class: "small" }, " · richiede la modalità laboratorio") : null,
          h("br"), h("span", { class: "small" }, v.motivo));
      }).filter(Boolean);
      return righe.length ? h("article", { class: "card" }, h("h3", {}, m.titolo), h("p", { class: "small" }, m.sommario), h("ul", { class: "st-righe" }, righe)) : null;
    });
    const sintesi = [STATO.DISPONIBILE, STATO.SIMULATO, STATO.SPERIMENTALE, STATO.HARDWARE, STATO.NON_DISPONIBILE]
      .filter((s) => conteggio[s]).map((s) => h("span", {}, distintivo(s), ` ${conteggio[s]} `));
    sostituisci(corpo, h("p", {}, sintesi), h("div", { class: "st-griglia" }, blocchi));
  };
  filtro.addEventListener("change", disegna);
  ctx.suAggiornamento(() => { if (!corpo.closest("[hidden]")) disegna(); });
  const el = h("div", {},
    h("p", { class: "small" }, "Ogni funzione di Polpo Studio, con il suo stato nel telefono adesso. «Non disponibile» vuol dire esclusa per scelta di sicurezza, oppure non ancora nell'app: il motivo è scritto."),
    h("label", {}, "Mostra ", filtro), corpo);
  return { id: "funzioni", titolo: "Tutte le funzioni", el, mostrato: disegna };
}
