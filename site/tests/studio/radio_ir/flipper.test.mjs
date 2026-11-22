// Parità con flipper_format.py e con le funzioni che imitano Python (int, float, formati, repr…).
import test from "node:test";
import assert from "node:assert/strict";
import * as F from "../../../assets/js/studio/protocolli/flipper.js";
import { casi, daDoc, verificaCasi } from "./aiuto.mjs";

const C = casi("flipper.json");
const U = casi("unicode.json");

test("tabelle Unicode: spazi, cifre decimali e cifre come in Python", () => {
  const spazi = new Set(U.spazi);
  const inSerie = (serie, cp) => serie.find(([a, b]) => a <= cp && cp <= b);
  for (let cp = 0; cp < 0x110000; cp++) {
    assert.equal(F.spazioPy(cp), spazi.has(cp), `spazio ${cp.toString(16)}`);
    const d = inSerie(U.decimali, cp);
    assert.equal(F.valoreDecimale(cp), d ? (cp - d[0]) % 10 : -1, `decimale ${cp.toString(16)}`);
    assert.equal(F.cifraPy(cp), Boolean(inSerie(U.cifre, cp)), `cifra ${cp.toString(16)}`);
  }
});

const gruppi = {
  parse: (t) => daDoc(F.leggiFf(t)),
  line: ([k, v]) => F.riga(k, v),
  header: ([t, v]) => F.intestazione(t, v),
  parse_hex_bytes: (t) => {
    const b = F.leggiByteEsa(t);
    return b === null ? null : Array.from(b);
  },
  hex_bytes: (b) => F.byteEsa(Uint8Array.from(b)),
  isdigit: F.soloCifre,
  strip: F.togliSpazi,
  split: F.dividi,
  int_dieci: (t) => F.interoDaTesto(t, 10),
  int_sedici: (t) => F.interoDaTesto(t, 16),
  float: F.decimaleDaTesto,
  fmt_fixed: ([x, n]) => F.virgolaFissa(x, n),
  repr_float: F.reprDecimale,
  repr_str: F.reprTesto,
  repr_json: F.reprPy,
  str_json: F.testoPy,
  int_json: F.interoDa,
  bool_json: F.veroPy,
  floordiv: ([a, b]) => F.divisioneIntera(a, b),
  truediv: ([a, b]) => F.divisioneVera(a, b),
  to_bytes: ([v, n, o]) => Array.from(F.inByte(v, n, o)),
  from_bytes: ([b, o]) => F.daByte(Uint8Array.from(b), o),
  hex_fmt: ([v, w]) => F.esaMaiuscolo(v, w),
  html_escape: F.escapeHtml,
  utf8_decode: (b) => F.testoDaByte(Uint8Array.from(b)),
  utf8_encode: (s) => Array.from(F.byteDaTesto(s)),
};

test("flipper.json: ogni gruppo ha la sua funzione JavaScript", () => {
  assert.deepStrictEqual(Object.keys(C).sort(), Object.keys(gruppi).sort());
});

for (const [nome, fn] of Object.entries(gruppi)) {
  test(`flipper: ${nome}`, () => {
    verificaCasi(C[nome], fn, nome);
  });
}
