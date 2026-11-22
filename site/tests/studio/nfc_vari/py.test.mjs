// Le regole di Python riprodotte in convertitore.js (int, float, strip, split, fromhex, format, round, repr, codifiche, Base64).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as P from "../../../assets/js/studio/strumenti/convertitore.js";
import { B, casi, confronta, D, esito, J } from "./aiuto.mjs";

const C = casi("py");
const esaPy = (v) => (v < 0n ? "-0x" + (-v).toString(16) : "0x" + v.toString(16));

test("int() con le basi 10, 16, 2, 8, 36 e int() di valori non testuali", () => {
  confronta(
    C.int.filter((c) => "s" in c),
    (c) => Object.fromEntries([10, 16, 2, 8, 36].map((b) => [String(b), esito(() => esaPy(P.intPy(D(c.s), b)))])),
  );
  confronta(
    C.int.filter((c) => "v" in c),
    (c) => esito(() => esaPy(P.intPy(D(c.v)))),
  );
});

test("float()", () => {
  confronta(C.float, (c) => esito(() => P.floatPy(D(c.s))));
});

test("strip(), split(), isascii(), len()", () => {
  confronta(
    C.testo,
    (c) => ({ s: c.s, strip: P.stripPy(c.s), split: P.splitPy(c.s), split1: P.splitPy(c.s, 1), split2: P.splitPy(c.s, 2), isascii: P.isasciiPy(c.s), len: P.lunghezzaPy(c.s) }),
    (c) => c,
  );
  confronta(C.isdigit, (c) => P.isdigitPy(c.s));
});

test("bytes.fromhex() e int.to_bytes()", () => {
  confronta(C.fromhex, (c) => esito(() => P.fromhexPy(c.s)));
  confronta(C.to_bytes, (c) => esito(() => P.interoInByte(c.v, c.n, c.ordine)));
});

test("format() dei numeri decimali", () => {
  confronta(C.format, (c) => Object.fromEntries(Object.keys(c.r).map((s) => [s, P.formatPy(D(c.x), s)])));
});

test("round(x, n), round(x), math.floor(x)", () => {
  confronta(C.round, (c) => [0, 1, 2, 4].map((n) => J(P.roundPy(D(c.x), n))));
  confronta(C.round_int, (c) => esito(() => BigInt(P.roundInteroPy(D(c.x))).toString()));
  confronta(C.floor, (c) => esito(() => BigInt(P.floorPy(D(c.x))).toString()));
});

test("repr() e str()", () => {
  confronta(C.repr, (c) => P.reprPy(c.s));
  confronta(C.str, (c) => P.strPy(c.v));
});

test("Base64 (b64decode rigido e b64encode)", () => {
  confronta(C.b64decode, (c) => esito(() => P.decodificaBase64(c.s)));
  confronta(C.b64encode, (c) => P.codificaBase64(B(c.b)));
});

test("decodifiche UTF-8, UTF-16 e ASCII con sostituzione; codifiche ASCII e UTF-8", () => {
  confronta(C.utf8, (c) => P.decodificaUtf8(B(c.b)));
  confronta(C.utf16, (c) => P.decodificaUtf16(B(c.b)));
  confronta(C.ascii, (c) => P.decodificaAscii(B(c.b)));
  confronta(C.ascii_enc, (c) => J(P.codificaAscii(c.s)));
  confronta(C.utf8_enc, (c) => esito(() => P.codificaUtf8(D(c.s))));
});

test("html.escape()", () => {
  confronta(C.html, (c) => P.escapeHtml(c.s));
});

test("formattaData come time.strftime", () => {
  const d = new Date(2026, 0, 2, 3, 4, 5);
  assert.equal(P.formattaData("%Y-%m-%d %H:%M:%S %%", d), "2026-01-02 03:04:05 %");
  assert.equal(P.formattaData("%d/%m/%Y %H:%M", d), "02/01/2026 03:04");
});

test("formatIntPy: zeri a sinistra dopo il segno, come Python", () => {
  assert.equal(P.formatIntPy(-5, "05d"), "-0005");
  assert.equal(P.formatIntPy(255, "02X"), "FF");
  assert.equal(P.formatIntPy(-0x123456789, "010X"), "-123456789");
  assert.equal(P.formatIntPy(5, "08b"), "00000101");
  assert.equal(P.formatIntPy(7, "3d"), "  7");
});
