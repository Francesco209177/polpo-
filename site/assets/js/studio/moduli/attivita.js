// Modulo «Registro»: le attività della sessione. Con la cassaforte aperta si salvano nel suo registro cifrato.
import { h, sostituisci, quando } from "../ui.js";

const LIVELLO = { info: "", ok: "ok", avviso: "need", errore: "off" };

export function crea(ctx) {
  const lista = h("ol", { class: "st-registro", reversed: true });
  const nota = h("p", { class: "small" });
  const disegna = () => {
    nota.textContent = ctx.cassaforte
      ? "Le voci si salvano nel registro cifrato della cassaforte."
      : "Cassaforte chiusa: le voci restano solo finché l'app è aperta e si salvano quando la apri (modulo Sicurezza).";
    sostituisci(lista, [...ctx.registro.voci].reverse().slice(0, 300).map((v) => h("li", { class: LIVELLO[v.level] || "" },
      h("span", { class: "small" }, quando(v.ts), " · ", v.category), " ", v.message, v.simulated ? " " : null, v.simulated ? h("span", { class: "badge sim" }, "Simulato") : null)));
  };
  ctx.registro.suAggiunta(() => { if (!lista.closest("[hidden]")) disegna(); });
  ctx.suAggiornamento(disegna);
  return { id: "registro", titolo: "Registro", el: h("div", {}, nota, lista), mostrato: disegna };
}
