// Modulo «Archivio» (in preparazione).
import { h } from "../ui.js";
export function crea(ctx) {
  return { id: "archivio", titolo: "Archivio", el: h("div", { class: "st-griglia" }, ...["files.browse", "files.io"].map((id) => ctx.scheda(id))) };
}
