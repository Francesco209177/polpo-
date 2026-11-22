// La copia di @noble/hashes: i file sono quelli verificati (INTEGRITA.json) e scrypt dà i risultati di RFC 7914.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scrypt, scryptAsync } from "../../../assets/js/terze-parti/noble-hashes-2.4.0/scrypt.js";

const qui = path.dirname(fileURLToPath(import.meta.url));
const CARTELLA = path.resolve(qui, "../../../assets/js/terze-parti/noble-hashes-2.4.0");
const testo = (s) => new TextEncoder().encode(s);
const esa = (b) => Buffer.from(b).toString("hex");

test("i file copiati hanno l'impronta scritta in INTEGRITA.json", () => {
  const integrita = JSON.parse(readFileSync(path.join(CARTELLA, "INTEGRITA.json"), "utf-8"));
  for (const [nome, impronta] of Object.entries(integrita)) {
    assert.match(impronta, /^[0-9a-f]{64}$/, nome);
    assert.equal(createHash("sha256").update(readFileSync(path.join(CARTELLA, nome))).digest("hex"), impronta, nome);
  }
  // nella cartella non c'è altro codice oltre a quello verificato
  const presenti = readdirSync(CARTELLA).filter((n) => !["INTEGRITA.json", "LEGGIMI.md"].includes(n));
  assert.deepEqual(presenti.sort(), Object.keys(integrita).sort());
  assert.ok(integrita["LICENSE"] && integrita["scrypt.js"]);
});

test("i file copiati importano solo file vicini, con percorsi relativi", () => {
  for (const nome of readdirSync(CARTELLA).filter((n) => n.endsWith(".js"))) {
    const codice = readFileSync(path.join(CARTELLA, nome), "utf-8");
    for (const [, da] of codice.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gm)) {
      assert.match(da, /^\.\/[\w-]+\.js$/, `${nome} importa ${da}`);
    }
    assert.doesNotMatch(codice, /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\s*\(/, nome);
  }
});

// RFC 7914, paragrafo 12 (il quarto vettore, N = 2^20, chiede 1 GB di memoria: qui si salta).
const VETTORI = [
  ["", "", 16, 1, 1, "77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906"],
  ["password", "NaCl", 1024, 8, 16, "fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640"],
  ["pleaseletmein", "SodiumChloride", 16384, 8, 1, "7023bdcb3afd7348461c06cd81fd38ebfda8fbba904f8e3ea9b543f6545da1f2d5432955613f0fcf62d49705242a9af9e61e85dc0d651e40dfcf017b45575887"],
];

test("scrypt: vettori di prova di RFC 7914 (versione sincrona e asincrona)", async () => {
  for (const [p, s, N, r, pp, atteso] of VETTORI) {
    assert.equal(esa(scrypt(testo(p), testo(s), { N, r, p: pp, dkLen: 64 })), atteso);
    let avanzamento = 0;
    const k = await scryptAsync(testo(p), testo(s), { N, r, p: pp, dkLen: 64, onProgress: (f) => (avanzamento = f) });
    assert.equal(esa(k), atteso);
    assert.equal(avanzamento, 1);
  }
});
