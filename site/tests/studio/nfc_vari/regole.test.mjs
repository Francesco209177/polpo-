// Regole del progetto per i moduli JavaScript di questa parte dello Studio: niente rete, niente Buffer, niente
// dipendenze, e (come il controllo del sito) nessun indirizzo web scritto per intero.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const FILE = [
  "protocolli/ndef.js",
  "protocolli/type2.js",
  "protocolli/rfid125.js",
  "protocolli/onewire.js",
  "protocolli/ducky.js",
  "protocolli/elettronica.js",
  "strumenti/convertitore.js",
  "strumenti/crc.js",
  "strumenti/ndef_app.js",
];
const sorgente = (f) => readFileSync(new URL(`../../../assets/js/studio/${f}`, import.meta.url), "utf8");

test("nessuna funzione di rete e nessun indirizzo web (stessa regola di site/build.py)", () => {
  for (const f of FILE) {
    const m = /https?:\/\/|\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|RTCPeerConnection|importScripts)\b/.exec(sorgente(f));
    assert.ok(m === null, `${f}: contiene «${m?.[0]}»`);
  }
});

test("solo moduli del sito: niente Buffer, niente require, niente import da Node o da pacchetti", () => {
  for (const f of FILE) {
    const s = sorgente(f);
    assert.ok(!/\bBuffer\b|\brequire\(|\bprocess\./.test(s), f);
    for (const [, da] of s.matchAll(/^import\s[^;]*?from\s+"([^"]+)"/gms)) assert.ok(da.startsWith("./") || da.startsWith("../"), `${f}: import da ${da}`);
  }
});

test("le funzioni rispondono con errori che portano il tipo dell'eccezione Python", async () => {
  const { intPy } = await import("../../../assets/js/studio/strumenti/convertitore.js");
  const { analizza } = await import("../../../assets/js/studio/protocolli/ndef.js");
  assert.throws(() => intPy("x"), { tipo: "ValueError", message: "invalid literal for int() with base 10: 'x'" });
  assert.throws(() => analizza(new Uint8Array(0)), { tipo: "ValueError", message: "messaggio NDEF vuoto" });
});

test("il controllo DuckyScript non esegue né invia nulla", async () => {
  const s = sorgente("protocolli/ducky.js");
  for (const parola of ["KeyboardEvent", "dispatchEvent", "navigator.", "requestPort", "SerialPort", "navigator.hid"]) assert.ok(!s.includes(parola), parola);
  const ducky = await import("../../../assets/js/studio/protocolli/ducky.js");
  const e = ducky.esitoControllo(ducky.ESEMPIO, "IT");
  assert.equal(e.testo, "Valido: 8 azioni, 22 caratteri, pause totali 1.5 s, durata stimata 1.8 s (layout IT).");
});
