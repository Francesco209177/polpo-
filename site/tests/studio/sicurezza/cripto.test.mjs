// Primitive crittografiche e formati (cripto.js, formati.js): stessi risultati di Polpo Studio in Python.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../../../assets/js/studio/sicurezza/cripto.js";
import * as F from "../../../assets/js/studio/sicurezza/formati.js";
import { esa, testo } from "./aiuto.mjs";

test("chiave di recupero: formato ed errori di trascrizione", () => {
  const k = C.nuovaChiaveRecupero();
  assert.equal(k.length, 39);
  assert.equal(k.split("-").length, 8);
  assert.match(k, /^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
  const grezza = C.normalizzaChiaveRecupero(k);
  assert.equal(grezza.length, 20);
  assert.deepEqual(C.normalizzaChiaveRecupero(k.toLowerCase().replaceAll("-", " ")), grezza);
  assert.deepEqual(C.normalizzaChiaveRecupero(` ${k.replaceAll("-", "")}\n`), grezza);
  assert.equal(C.normalizzaChiaveRecupero("ABCD"), null);
  assert.equal(C.normalizzaChiaveRecupero(k + "A"), null);
  assert.equal(C.normalizzaChiaveRecupero(k.replace(/.$/, "9")), null); // 9 non è nell'alfabeto
  assert.equal(C.normalizzaChiaveRecupero(k.replace("-", "\r")), null); // come Python: \r non viene tolto
  assert.equal(C.normalizzaChiaveRecupero(null), null);
  // 0 → O, 1 → I, 8 → B
  const a = "OIBA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA";
  assert.deepEqual(C.normalizzaChiaveRecupero("01ba-aaaa-aaaa-aaaa-aaaa-aaaa-aaaa-aaaa"), C.normalizzaChiaveRecupero(a));
  assert.equal(esa(C.normalizzaChiaveRecupero(a)), "720200" + "00".repeat(17)); // base64.b32decode di Python
  // 160 bit davvero casuali: due chiavi diverse
  assert.notEqual(C.nuovaChiaveRecupero(), C.nuovaChiaveRecupero());
});

test("regole della frase di accesso", () => {
  assert.ok(C.problemiFrase("corta").includes("short"));
  assert.deepEqual(C.problemiFrase("cavallo batteria graffetta"), []);
  assert.deepEqual(C.problemiFrase("aaaaaaaaaaaaaaaa"), ["repetitive"]);
  assert.deepEqual(C.problemiFrase("Password1234"), ["common"]);
  assert.deepEqual(C.problemiFrase("🐙🐙🐙"), ["short", "repetitive"]); // conta i caratteri, non le unità UTF-16
  assert.equal(C.SUGGERIMENTI_FRASE.short, "almeno 12 caratteri");
});

test("HKDF senza sale: vettore 3 di RFC 5869 (primi 32 byte)", async () => {
  const k = await C.hkdf(new Uint8Array(22).fill(0x0b), "");
  assert.equal(esa(k), "8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d");
});

test("SHA-256, HMAC e confronto", async () => {
  assert.equal(await C.sha256(testo("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  // RFC 4231, caso 2
  assert.equal(await C.mac(testo("Jefe"), testo("what do ya want for nothing?")), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  assert.ok(await C.macValido(testo("Jefe"), testo("what do ya want for nothing?"), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"));
  assert.ok(!(await C.macValido(testo("Jefe"), testo("what do ya want for nothing!"), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843")));
  assert.ok(!C.ugualiCostante("ab", "abc"));
});

test("AES-GCM: nonce ‖ cifrato ‖ etichetta; alterazioni e AAD diversi → ErroreIntegrita", async () => {
  const k = F.casuali(32);
  const blob = await C.sigilla(k, testo("ciao"), testo("aad"));
  assert.equal(blob.length, 12 + 4 + 16);
  assert.deepEqual(await C.dissigilla(k, blob, testo("aad")), testo("ciao"));
  await assert.rejects(C.dissigilla(k, blob, testo("altro")), { name: "ErroreIntegrita", message: "autenticazione fallita" });
  const rotto = blob.slice();
  rotto[13] ^= 1;
  await assert.rejects(C.dissigilla(k, rotto, testo("aad")), C.ErroreIntegrita);
  await assert.rejects(C.dissigilla(k, blob.subarray(0, 27), testo("aad")), { message: "dati troppo corti" });
  await assert.rejects(C.dissigilla(F.casuali(32), blob, testo("aad")), C.ErroreIntegrita);
  await assert.rejects(C.sigilla(F.casuali(31), testo("x"), testo("")), F.ErroreValore);
});

test("scrypt: avanzamento e parametri non validi", async () => {
  const visti = [];
  const k = await C.deriva(testo("frase"), testo("sale"), 1024, 8, 1, { progresso: (f) => visti.push(f) });
  assert.equal(k.length, 32);
  assert.equal(visti.at(-1), 1);
  assert.ok(visti.every((f, i) => i === 0 || f >= visti[i - 1]));
  await assert.rejects(C.deriva(testo("x"), testo("y"), 1000), F.ErroreValore);
  await assert.rejects(C.deriva(testo("x"), testo("y"), 1024, 0), F.ErroreValore);
  // RFC 7914, vettore 2 (solo i primi 32 byte: l'uscita di derive è di 32 byte)
  assert.equal(esa(await C.deriva(testo("password"), testo("NaCl"), 1024, 8, 16)), "fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b373162");
});

test("base64 rigido come base64.b64decode(validate=True)", () => {
  const casi = {
    "": "", "QQ==": "41", "QUI=": "4142", "QUJ=": "4142", "QUJD": "414243", "QR==": "41", "AB==": "00", "ABC=": "0010",
  };
  for (const [s, h] of Object.entries(casi)) assert.equal(esa(F.daBase64(s)), h, s);
  for (const s of ["QQ=", "QQ", "QUJDR", "QR=", "Q===", "QQ==QQ==", "QU JD", "QUJD\n", "QUJDRA", "=", "==", "A===", "QUJD=", "QQ===", "é===", "QU-D", "QU_D"]) {
    assert.throws(() => F.daBase64(s), F.ErroreValore, JSON.stringify(s));
  }
  for (let n = 0; n < 40; n++) {
    const b = F.casuali(n);
    const s = F.inBase64(b);
    assert.equal(s, Buffer.from(b).toString("base64"));
    assert.deepEqual(F.daBase64(s), b);
  }
});

test("JSON come json.dumps di Python", () => {
  const x = { a: 1.5, b: 1e16, c: 1e-5, d: 0.0001, e: 1.5e-7, f: 123456789.123, g: "è\x7f\u2028\x01😀", h: [], i: {}, j: null, k: true, l: -2, m: 1e22, n: [1, { o: [] }] };
  assert.equal(
    F.jsonPython(x),
    '{"a": 1.5, "b": 10000000000000000, "c": 1e-05, "d": 0.0001, "e": 1.5e-07, "f": 123456789.123, "g": "\\u00e8\\u007f\\u2028\\u0001\\ud83d\\ude00", "h": [], "i": {}, "j": null, "k": true, "l": -2, "m": 1e+22, "n": [1, {"o": []}]}',
  );
  assert.equal(F.jsonPython({ g: "è\x7f\u2028\x01😀\n\"\\" }, { soloAscii: false }), '{"g": "è\x7f\u2028\\u0001😀\\n\\"\\\\"}');
  assert.equal(F.jsonPython({ a: [1, { b: [] }], c: {} }, { rientro: 2 }), '{\n  "a": [\n    1,\n    {\n      "b": []\n    }\n  ],\n  "c": {}\n}');
});

test("regole di Python sul testo", () => {
  assert.equal(F.stripPython(" \x1c a b \x85\u3000"), "a b");
  assert.equal(F.stripPython("\ufeffa"), "\ufeffa"); // per Python il BOM non è uno spazio
  assert.deepEqual(F.righeNonVuote("a\r\nb\rc\n\n  \nd\x85e\u2028f\n"), ["a", "b", "c", "d", "e", "f"]);
  assert.ok(F.soloCifre("2468") && F.soloCifre("١٢٣٤") && !F.soloCifre("12a4") && !F.soloCifre("") && !F.soloCifre(" 1234"));
  assert.equal(F.lunghezzaPython("a🐙b"), 3);
  assert.equal(F.interoPython("  1_024 "), 1024);
  assert.equal(F.interoPython(1024.9), 1024);
  assert.equal(F.interoPython(true), 1);
  assert.throws(() => F.interoPython("0x400"), F.ErroreValore);
  assert.throws(() => F.interoPython(null), TypeError);
  assert.equal(F.strPython(null), "None");
});

test("zlib: comprimi e decomprimi (formato RFC 1950, come zlib.compress)", async () => {
  const dati = testo("polpo ".repeat(1000));
  const z = await F.comprimi(dati);
  assert.equal(z[0], 0x78); // intestazione zlib
  assert.ok(z.length < dati.length / 10);
  assert.deepEqual(await F.decomprimi(z), dati);
  // zlib.compress(b"ciao") di Python
  assert.deepEqual(await F.decomprimi(Uint8Array.from(Buffer.from("789c4bce4ccc070003fc019d", "hex"))), testo("ciao"));
  await assert.rejects(F.decomprimi(testo("non compresso")), F.ErroreValore);
});
