// Parità con apps/radio_budget.py (stima del tempo in aria e del limite orario).
import test from "node:test";
import assert from "node:assert/strict";
import * as B from "../../../assets/js/studio/protocolli/budget_radio.js";
import { casi, verificaCasi } from "./aiuto.mjs";

const C = casi("budget_radio.json");

test("budget radio: limite e manifest", () => {
  assert.equal(B.LIMITE_BUDGET_RF_MS, C.limite_ms);
  assert.deepStrictEqual({ ...B.MANIFEST }, C.manifest);
});

test("budget radio: stima", () => {
  verificaCasi(C.stima, ([p, b, imp, rip]) => B.stima(p, b, imp, rip), "stima");
});

test("budget radio: testo dell'app", () => {
  verificaCasi(C.testo, ([p, b, imp, rip]) => B.testoStima(p, b, imp, rip), "testo");
});

test("budget radio: i valori iniziali dei campi sono nei limiti", () => {
  for (const c of B.CAMPI_STIMA) assert.ok(c.min <= c.valore && c.valore <= c.max, c.chiave);
  const v = Object.fromEntries(B.CAMPI_STIMA.map((c) => [c.chiave, c.valore]));
  assert.deepStrictEqual(B.stima(v.protocollo, v.bit, v.impulsoUs, v.ripetizioni), [179.2, 1607]);
});
