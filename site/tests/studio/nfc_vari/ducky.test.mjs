// DuckyScript: stesso validatore di studio/polpo_studio/protocols/ducky.py (solo controllo, nessuna esecuzione).
import { test } from "node:test";
import * as ducky from "../../../assets/js/studio/protocolli/ducky.js";
import { casi, confronta, daPezzi, esito } from "./aiuto.mjs";

const C = casi("ducky");

export const scriptPy = (s) => ({
  actions: s.azioni.map((a) => `${a.tipo} ${a.riga} ${a.modificatori} ${a.codice} ${a.ms} ${a.testo}`),
  errors: s.errori,
  line_count: s.righe,
  total_delay_ms: s.pauseTotaliMs,
  total_chars: s.caratteriTotali,
  ok: s.ok,
  seconds: ducky.stimaSecondi(s),
  seconds_5: ducky.stimaSecondi(s, 5),
});

test("analisi degli script (comandi, errori, limiti di byte, righe e azioni)", () => {
  confronta(C.parse, (c) => esito(() => scriptPy(ducky.analizza(daPezzi(c.src), c.layout)), (x) => x));
});

test("tabelle dei layout IT e US", () => {
  confronta(C.layout_lookup, (c) => ducky.cercaNelLayout(c.l, c.c));
});
