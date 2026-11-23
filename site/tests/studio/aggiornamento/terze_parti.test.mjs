// La copia di esptool-js (file verificati, stub inclusi, niente rete) e le regole del sito per i file di
// aggiornamento/ (nessuna funzione di rete, import relativi), più l'MD5 scritto a mano.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getStubJsonByChipName } from "../../../assets/js/terze-parti/esptool-js-0.7.1/bundle.js";
import { md5 } from "../../../assets/js/studio/aggiornamento/md5.js";
import { RADICE } from "./aiuto.mjs";
import { FIRMWARE } from "./firmware_dati_esempio.mjs";

const qui = path.dirname(fileURLToPath(import.meta.url));
const CARTELLA = path.resolve(qui, "../../../assets/js/terze-parti/esptool-js-0.7.1");
const AGGIORNAMENTO = path.resolve(qui, "../../../assets/js/studio/aggiornamento");
const sha = (b) => createHash("sha256").update(b).digest("hex");

test("esptool-js: i file copiati hanno l'impronta scritta in INTEGRITA.json, e non c'è altro", () => {
  const integrita = JSON.parse(readFileSync(path.join(CARTELLA, "INTEGRITA.json"), "utf-8"));
  for (const [nome, impronta] of Object.entries(integrita)) {
    assert.match(impronta, /^[0-9a-f]{64}$/, nome);
    assert.equal(sha(readFileSync(path.join(CARTELLA, nome))), impronta, nome);
  }
  const presenti = readdirSync(CARTELLA, { recursive: true }).filter((n) => !["INTEGRITA.json", "LEGGIMI.md"].includes(n));
  assert.deepEqual(presenti.sort(), Object.keys(integrita).sort());
  assert.ok(integrita["bundle.js"] && integrita["LICENSE"] && integrita["NOTICE"]);
});

test("esptool-js: bundle.js è un modulo unico (nessun import, nemmeno dinamico) e non chiama funzioni di rete", () => {
  const codice = readFileSync(path.join(CARTELLA, "bundle.js"), "utf-8");
  assert.doesNotMatch(codice, /\bimport\s*\(|\bimport\s*["'{*]|\bfrom\s*["']/);
  assert.doesNotMatch(codice, /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\s*\(/);
  assert.match(codice, /export\s*\{[^}]*\bESPLoader\b[^}]*\}/);
});

test("esptool-js: lo stub dell'ESP32-S3 è dentro il file (quello di lib/targets/stub_flasher/esp32s3.json di 0.7.1)", async () => {
  const s = await getStubJsonByChipName("ESP32-S3");
  assert.equal(s.entry, 0x40379524);
  assert.equal(s.text_start, 0x40378000);
  assert.equal(s.data_start, 0x3fcb2dc0);
  assert.equal(sha(s.decodedText), "c37a7d12d52633fd629fbed13f3a7418216af368d8e80f17853ce6de29741374");
  assert.equal(sha(s.decodedData), "75be8e20e5c91b2b92cd02be9abe2462436648780e4878ea173598c5ed14df93");
});

test("aggiornamento/: niente indirizzi né funzioni di rete (la regola di site/build.py), import relativi che esistono", () => {
  const file = readdirSync(AGGIORNAMENTO).filter((n) => n.endsWith(".js"));
  assert.deepEqual(file.sort(), ["firmware.js", "md5.js", "porta.js"]);
  for (const nome of file) {
    const codice = readFileSync(path.join(AGGIORNAMENTO, nome), "utf-8");
    const m = codice.match(/https?:\/\/|\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|RTCPeerConnection|importScripts)\b/);
    assert.equal(m, null, `${nome} contiene «${m && m[0]}»`);
    for (const [, da] of codice.matchAll(/^\s*import\b[^;]*?\bfrom\s+["']([^"']+)["']/gm)) {
      assert.match(da, /^\.\.?\//, `${nome} importa ${da}`);
      assert.ok(existsSync(path.resolve(AGGIORNAMENTO, da)), `${nome}: ${da} non esiste`);
    }
  }
});

test("md5: uguale a quello di node:crypto, anche sui bordi dei blocchi da 64 byte e sull'applicazione vera", () => {
  for (const n of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 121, 1000, 65537]) {
    const b = randomBytes(n);
    assert.equal(md5(b), createHash("md5").update(b).digest("hex"), `${n} byte`);
  }
  assert.equal(md5(new TextEncoder().encode("abc")), "900150983cd24fb0d6963f7d28e17f72"); // RFC 1321
  const vera = path.join(RADICE, "polpo/release", FIRMWARE.app_file);
  if (existsSync(vera)) {
    const b = readFileSync(vera);
    assert.equal(md5(b), createHash("md5").update(b).digest("hex"));
  }
});
