// Modulo «Radio 433 MHz» (in preparazione).
import { h } from "../ui.js";
export function crea(ctx) {
  return { id: "radio", titolo: "Radio 433", el: h("div", { class: "st-griglia" }, ...["radio.rx", "radio.raw", "radio.tx"].map((id) => ctx.scheda(id))) };
}
