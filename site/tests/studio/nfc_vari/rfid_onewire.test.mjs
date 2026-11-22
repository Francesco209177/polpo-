// Tessere 125 kHz e 1-Wire: stessi risultati di studio/polpo_studio/protocols/rfid125.py e onewire.py.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as rfid from "../../../assets/js/studio/protocolli/rfid125.js";
import * as ow from "../../../assets/js/studio/protocolli/onewire.js";
import { hexPy } from "../../../assets/js/studio/strumenti/convertitore.js";
import { B, casi, confronta, esito } from "./aiuto.mjs";

const R = casi("rfid125");
const O = casi("onewire");

export const emPy = (c) =>
  c && { version: c.versione, number: c.numero, value: c.valore, hex: c.esadecimale, decimal10: c.decimale10, w26: c.w26, w26_text: c.testoW26, w26_bits: c.bitW26 };

export const romPy = (r) =>
  r && { raw: hexPy(r.grezzi), family: r.famiglia, family_name: r.nomeFamiglia, serial: r.seriale, crc_ok: esito(() => r.crcOk), text: r.testo };

test("125 kHz: riconoscimento dei formati scritti", () => {
  confronta(R.parse_code, (c) => esito(() => rfid.analizzaCodice(c.t), ([card, fmt]) => [emPy(card), fmt]));
});

test("125 kHz: formati di un codice EM4100 e trame RDM6300", () => {
  confronta(R.em4100, (c) => {
    const card = new rfid.Em4100(c.v, c.n);
    return { v: c.v, n: c.n, r: emPy(card), frame: esito(() => rfid.tramaRdm6300(card)) };
  }, (c) => c);
});

test("125 kHz: lettura delle trame RDM6300 a pezzi", () => {
  confronta(R.rdm6300, (passi) => {
    const p = new rfid.ParserRdm6300();
    const out = [];
    for (const passo of passi) {
      const r = esito(() => p.alimenta(B(passo.dati)), (cs) => cs.map((x) => x.esadecimale));
      out.push({ dati: passo.dati, r, scartate: p.trameScartate });
      if (r.errore) break;
    }
    return out;
  }, (passi) => passi);
});

test("125 kHz: raffiche di tasti dei lettori «tipo tastiera»", () => {
  confronta(R.burst, (c) => {
    const b = rfid.rafficaDaTempi(c.chars);
    return { chars: c.chars, text: b.testo, duration_ms: b.durataMs, max_gap_ms: b.pausaMaxMs, reader: b.sembraLettore };
  }, (c) => c);
});

test("1-Wire: CRC8, analisi dei codici ROM, costruzione", () => {
  confronta(O.crc8, (c) => ow.crc8(B(c.b)));
  confronta(O.parse_rom, (c) => romPy(ow.analizzaRom(c.t)));
  confronta(O.make_rom, (c) => esito(() => ow.creaRom(c.f, c.s), romPy));
});

test("valori noti", () => {
  assert.equal(ow.crc8(new TextEncoder().encode("123456789")), 0xa1);
  const c = new rfid.Em4100(0, 12345678);
  assert.equal(c.decimale10, "0012345678");
  assert.equal(c.testoW26, "188,24910");
  assert.deepEqual(rfid.analizzaCodice("0012345678")[0], c);
  const p = new rfid.ParserRdm6300();
  const t = rfid.tramaRdm6300(new rfid.Em4100(0x1a, 0x2b3c4d5e));
  assert.deepEqual(p.alimenta(t.subarray(0, 5)), []);
  assert.equal(p.alimenta(t.subarray(5))[0].esadecimale, "1A2B3C4D5E");
});
