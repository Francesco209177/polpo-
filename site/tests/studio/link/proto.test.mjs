// Polpo Link in JavaScript: le stesse regole del firmware e della copia Python.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import * as P from "../../../assets/js/studio/link/proto.js";
import { RADICE } from "./aiuto.mjs";

const enc = new TextEncoder();
const txt = (b) => (b === null ? null : new TextDecoder().decode(b));

test("la tabella dei comandi e le costanti sono quelle del firmware", () => {
  const sorgente = fs.readFileSync(path.join(RADICE, "polpo/lib/polpo_core/src/polpo/link/link_proto.cpp"), "utf8");
  const fw = Object.fromEntries([...sorgente.matchAll(/\{"([a-z0-9_.]+)", (true|false), (true|false)\}/g)].map((m) => [m[1], [m[2] === "true", m[3] === "true"]]));
  const js = Object.fromEntries(Object.values(P.COMANDI).map((c) => [c.nome, [c.sessione, c.sensibile]]));
  assert.deepEqual(js, fw);
  const h = fs.readFileSync(path.join(RADICE, "polpo/lib/polpo_core/src/polpo/link/link_proto.h"), "utf8");
  assert.ok(h.includes(`kProtocolVersion = ${P.VERSIONE_PROTOCOLLO};`));
  assert.ok(h.includes(`kMaxLine = ${P.RIGA_MAX};`));
  assert.ok(h.includes(`kMaxChunk = ${P.BLOCCO_MAX};`));
  assert.ok(h.includes("kMaxFileSize = 256 * 1024;") && P.FILE_MAX === 256 * 1024);
});

test("righe: «\\r» ignorato, blocchi spezzati, riga vuota", () => {
  const d = new P.DivisoreRighe();
  assert.deepEqual(d.aggiungi(enc.encode('{"a":1}\r\n{"b"')).map(txt), ['{"a":1}']);
  assert.deepEqual(d.aggiungi(enc.encode(':2}\n\n')).map(txt), ['{"b":2}', ""]);
});

test("righe troppo lunghe: segnalate una volta, poi si riparte", () => {
  const d = new P.DivisoreRighe(8);
  assert.deepEqual(d.aggiungi(enc.encode("12345678")), []);
  assert.deepEqual(d.aggiungi(enc.encode("9")), [null]);
  assert.deepEqual(d.aggiungi(enc.encode("more garbage")), []);
  assert.deepEqual(d.aggiungi(enc.encode("\nok\n")).map(txt), ["ok"]);
  const g = new P.DivisoreRighe(8);
  assert.deepEqual(g.aggiungi(enc.encode("12345678\n")).map(txt), ["12345678"]); // esattamente al limite
});

test("base64 e CRC-32 come Python (zlib) su dati a caso", () => {
  let seme = 7;
  const caso = () => (seme = (seme * 1103515245 + 12345) & 0x7fffffff) & 255;
  for (let n = 0; n < 300; n++) {
    const b = Uint8Array.from({ length: n * 3 % 1000 }, caso);
    const atteso = Buffer.from(b).toString("base64");
    assert.equal(P.base64(b), atteso);
    assert.deepEqual(P.daBase64(atteso), b);
    assert.equal(P.crc32(b), zlib.crc32(Buffer.from(b)));
  }
  assert.equal(P.crc32(enc.encode("123456789")), 0xcbf43926);
  for (const cattivo of ["A", "AB=", "A===", "AB=C", "ab$d", "AAAA=AAA", 5, "àààà"]) assert.equal(P.daBase64(cattivo), null, String(cattivo));
  assert.deepEqual(P.daBase64(""), new Uint8Array(0));
});

test("percorsi della microSD", () => {
  for (const ok of ["/polpo", "/polpo/ir/tv.ir", "/polpo/script/a_b-c.polpo"]) assert.ok(P.percorsoValido(ok), ok);
  for (const no of ["/polpo2", "/etc/passwd", "/polpo/../x", "/polpo//x", "/polpo/con spazio", "/polpo/è", "/pol", "/polpo/" + "a".repeat(90)]) {
    assert.ok(!P.percorsoValido(no), no);
  }
  assert.ok(P.percorsoSensibile("/polpo/badusb/x.txt") && !P.percorsoSensibile("/polpo/ir/x.ir"));
  assert.equal(P.esadecimale(Uint8Array.of(1, 0xab), ":"), "01:AB");
});
