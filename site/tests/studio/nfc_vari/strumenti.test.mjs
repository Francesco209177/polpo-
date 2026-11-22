// Convertitore, calcolatore CRC e costruttore NDEF: stessi risultati di studio/polpo_studio/apps/*.py,
// anche quello che mostrano le loro pagine (guidate da Python senza finestra).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as conv from "../../../assets/js/studio/strumenti/convertitore.js";
import * as crc from "../../../assets/js/studio/strumenti/crc.js";
import * as app from "../../../assets/js/studio/strumenti/ndef_app.js";
import { B, casi, confronta, D, esito } from "./aiuto.mjs";

const CV = casi("convertitore");
const CR = casi("crc");
const NA = casi("ndef_app");

test("convertitore: tutte le rappresentazioni, anche gli errori", () => {
  confronta(CV.convert, (c) => esito(() => conv.converti(D(c.t), c.k)));
});

test("convertitore: le righe della pagina («—» se il valore non è valido)", () => {
  confronta(CV.pagina, (c) => {
    const r = conv.convertiPerVista(c.t, c.k);
    return conv.USCITE.map(([k]) => r[k]);
  });
  assert.deepEqual(CV.manifest[0], { ...conv.MANIFEST });
});

test("CRC8, CRC16-CCITT, CRC16-Modbus, CRC32, SHA-256", () => {
  confronta(
    CR.checks,
    (c) => {
      const d = B(c.b);
      return { b: c.b, ccitt: crc.crc16Ccitt(d), ccitt0: crc.crc16Ccitt(d, 0), modbus: crc.crc16Modbus(d), crc32: crc.crc32(d), sha256: conv.hexPy(crc.sha256(d)), r: crc.controlli(d) };
    },
    (c) => c,
  );
});

test("calcolatore CRC: le righe della pagina (testo o esadecimale)", () => {
  confronta(CR.pagina, (c) => crc.controlliDaTesto(c.t, c.hex));
  assert.deepEqual(CR.manifest[0], { ...crc.MANIFEST });
});

test("costruttore NDEF: byte e spazio occupato", () => {
  confronta(NA.build, (c) => esito(() => app.costruisci(c.k, c.v, c.l)));
  confronta(NA.pagina, (c) => app.descrivi(c.k, c.v), (c) => ({ byte: c.byte, spazio: c.spazio }));
  assert.deepEqual(NA.manifest[0], { ...app.MANIFEST });
});

test("valori noti dei controlli", () => {
  const d = new TextEncoder().encode("123456789");
  assert.deepEqual(crc.controlli(d), {
    "CRC8 Dallas/Maxim": "A1",
    "CRC16-CCITT (FFFF)": "29B1",
    "CRC16-Modbus": "4B37",
    CRC32: "CBF43926",
    "SHA-256": "15e2b0d3c33891ebb0f1ef609ec419420c20e320ce94c65fbc8c3312448eb225",
  });
  assert.equal(conv.converti("50 6F 6C 70 6F", "hex").ascii, "Polpo");
});
