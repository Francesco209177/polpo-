// Strumenti comuni alle prove «vari5» (Polpo Bridge, USB, console seriale, Bluetooth, app integrate, codifica IR).
// I casi sono in site/tests/studio/casi/vari5/*.json (vedi genera_vari5.py) e casi/ir_codifica/ (genera_ir_codifica.py).
// Le convenzioni sono quelle di nfc_vari: errori {tipo, msg}, byte in esadecimale, {cp: [...]} per i surrogati.
import { readFileSync } from "node:fs";

export { B, D, J, confronta, esito } from "../nfc_vari/aiuto.mjs";

const CARTELLA = new URL("../casi/vari5/", import.meta.url);

/** I casi di un file (es. "bridge"). */
export function casi(nome) {
  return JSON.parse(readFileSync(new URL(`${nome}.json`, CARTELLA), "utf8"));
}

/** Ora fissa usata dal generatore: 22/11/2026 09:05:07, ora locale. */
export const ORA = new Date(2026, 10, 22, 9, 5, 7);
/** La stessa ora come la scrive common.stamp() di Polpo Studio. */
export const STAMP = "09:05:07";
