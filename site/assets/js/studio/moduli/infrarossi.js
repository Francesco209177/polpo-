// Modulo «Infrarossi» (in preparazione).
import { h } from "../ui.js";
export function crea(ctx) {
  return { id: "infrarossi", titolo: "Infrarossi", el: h("div", { class: "st-griglia" }, ...["ir.library", "ir.send", "ir.learn"].map((id) => ctx.scheda(id))) };
}
