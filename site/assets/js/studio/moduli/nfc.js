// Modulo «NFC» (in preparazione).
import { h } from "../ui.js";
export function crea(ctx) {
  return { id: "nfc", titolo: "NFC", el: h("div", { class: "st-griglia" }, ...["nfc.read", "nfc.write"].map((id) => ctx.scheda(id))) };
}
