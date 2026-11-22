import test from "node:test";
import assert from "node:assert/strict";
import { EXP, LOG, mul, div, inv, alfa } from "../../assets/js/onde/gf256.js";
import { crc8, crc16 } from "../../assets/js/onde/crc.js";
import { codifica, decodifica, sindromi, generatore } from "../../assets/js/onde/rs.js";
import * as P from "../../assets/js/onde/protocollo.js";
import { casuale, testoCasuale } from "./aiuto.mjs";

const ascii = (s) => new TextEncoder().encode(s);

test("GF(256): tabelle e operazioni coerenti", () => {
  assert.equal(EXP[0], 1);
  assert.equal(EXP[8], 0x1d); // α^8 = x^4+x^3+x^2+1
  assert.equal(alfa(255), 1);
  assert.equal(alfa(-1), inv(2));
  for (let a = 1; a < 256; a++) {
    assert.equal(EXP[LOG[a]], a);
    assert.equal(mul(a, inv(a)), 1);
    assert.equal(mul(a, 1), a);
    assert.equal(mul(a, 0), 0);
  }
  const rnd = casuale(1);
  for (let i = 0; i < 2000; i++) {
    const a = rnd.intero(256), b = 1 + rnd.intero(255), c = rnd.intero(256);
    assert.equal(div(mul(a, b), b), a);
    assert.equal(mul(a, b ^ c), mul(a, b) ^ mul(a, c)); // distributiva
    assert.equal(mul(mul(a, b), c), mul(a, mul(b, c))); // associativa
  }
  assert.throws(() => div(1, 0), RangeError);
});

test("CRC: valori di riferimento pubblici", () => {
  assert.equal(crc8(ascii("123456789")), 0xf4);
  assert.equal(crc16(ascii("123456789")), 0x29b1);
  assert.equal(crc16([]), 0xffff);
});

test("Reed–Solomon: vettore pubblico dei codici QR (versione 1-M, «HELLO WORLD»)", () => {
  const dati = Uint8Array.of(32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17);
  const parola = codifica(dati, 10);
  assert.deepEqual(Array.from(parola.subarray(16)), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  assert.deepEqual(Array.from(parola.subarray(0, 16)), Array.from(dati));
  assert.ok(sindromi(parola, 10).every((v) => v === 0));
  assert.deepEqual(Array.from(generatore(2)), [1, 3, 2]); // (x+1)(x+2)
});

test("Reed–Solomon: corregge errori e cancellature fino al limite 2·errori + cancellature ≤ parità", () => {
  const rnd = casuale(20261122);
  for (let giro = 0; giro < 1500; giro++) {
    const nsym = 2 + rnd.intero(63);
    const k = 1 + rnd.intero(Math.min(190, 255 - nsym));
    const parola = codifica(rnd.bytes(k), nsym);
    const n = parola.length;
    const canc = rnd.intero(Math.min(nsym, n) + 1);
    const err = rnd.intero(Math.floor((nsym - canc) / 2) + 1);
    if (canc + err > n) continue;
    const posti = rnd.scegli(n, canc + err);
    const ricevuta = Uint8Array.from(parola);
    for (const p of posti.slice(canc)) ricevuta[p] ^= 1 + rnd.intero(255); // errori veri
    for (const p of posti.slice(0, canc)) if (rnd() < 0.8) ricevuta[p] = rnd.intero(256); // cancellature (a volte il byte è giusto)
    const r = decodifica(ricevuta, nsym, posti.slice(0, canc));
    assert.ok(r, `non corretto: n=${n} nsym=${nsym} cancellature=${canc} errori=${err}`);
    assert.deepEqual(Array.from(r.parola), Array.from(parola));
  }
});

test("Reed–Solomon: oltre il limite non restituisce mai una parola non valida", () => {
  const rnd = casuale(7);
  let rifiutate = 0, sbagliate = 0;
  for (let giro = 0; giro < 800; giro++) {
    const nsym = 4 + 2 * rnd.intero(8);
    const parola = codifica(rnd.bytes(10 + rnd.intero(60)), nsym);
    const ricevuta = Uint8Array.from(parola);
    for (const p of rnd.scegli(parola.length, nsym / 2 + 1 + rnd.intero(4))) ricevuta[p] ^= 1 + rnd.intero(255);
    const r = decodifica(ricevuta, nsym);
    if (!r) { rifiutate++; continue; }
    assert.ok(sindromi(r.parola, nsym).every((v) => v === 0), "restituita una parola che non appartiene al codice");
    if (!r.parola.every((v, i) => v === parola[i])) sbagliate++;
  }
  assert.ok(rifiutate > 500, `quasi tutti i casi oltre il limite vanno rifiutati (rifiutati ${rifiutate}, corretti male ${sbagliate})`);
});

test("Reed–Solomon: parole senza errori, cancellature tutte sulla parità, argomenti sbagliati", () => {
  const parola = codifica(ascii("polpo"), 8);
  assert.deepEqual(decodifica(parola, 8), { parola, errori: 0, cancellature: 0 });
  const rotta = Uint8Array.from(parola);
  for (let i = 5; i < 13; i++) rotta[i] = 0;
  assert.deepEqual(Array.from(decodifica(rotta, 8, [5, 6, 7, 8, 9, 10, 11, 12]).parola), Array.from(parola));
  assert.equal(decodifica(rotta, 8, [0, 1, 2, 3, 4, 5, 6, 7, 8]), null); // troppe cancellature
  assert.throws(() => decodifica(rotta, 8, [3, 3]), RangeError);
  assert.throws(() => decodifica(rotta, 8, [99]), RangeError);
  assert.throws(() => codifica(new Uint8Array(250), 10), RangeError);
});

test("Protocollo: salti di frequenza e toni", () => {
  assert.deepEqual(Array.from({ length: 16 }, (_, i) => P.salto(i)), [0, 5, 7, 0, 14, 11, 5, 6, 12, 1, 3, 12, 10, 7, 1, 2]);
  for (const parte of [0, 1]) {
    const visti = new Set();
    for (let m = 0; m < 16; m++) visti.add(P.salto(2 * m + parte));
    assert.equal(visti.size, 16, "ogni banco passa per tutti e 16 i toni");
  }
  for (let i = 0; i < 200; i++) for (let v = 0; v < 16; v++) assert.equal(P.nibbleDi(i, P.tonoDi(i, v)), v);
  assert.equal(P.frequenza(0, 0), 1600);
  assert.equal(P.frequenza(1, 0), 1650);
  assert.equal(P.frequenza(1, 15), 3150);
  assert.equal(P.F_MAX, 3150);
});

test("Protocollo: dimensioni e durata della trama", () => {
  assert.equal(P.parita(3), 8);
  assert.equal(P.parita(7), 8);
  assert.equal(P.parita(9), 10);
  assert.equal(P.parita(34), 34);
  assert.equal(P.parita(122), 64);
  assert.equal(P.byteDati(5), 15);
  assert.equal(P.simboliTrama(5), 22 + 30);
  assert.equal(P.byteDati(120), 186);
  assert.ok(Math.abs(P.durata(5) - 3.68) < 0.01, `«Ciao!» dura ${P.durata(5)} s`);
  assert.ok(P.durata(32) < 10.1 && P.durata(120) < 24.5, `32 byte: ${P.durata(32)} s, 120 byte: ${P.durata(120)} s`);
});

test("Protocollo: vettore di prova «Ciao!»", () => {
  const t = P.componi("Ciao!");
  assert.deepEqual(Array.from(t.carico), [0x43, 0x69, 0x61, 0x6f, 0x21]);
  assert.deepEqual(Array.from(t.intestazione.subarray(0, 3)), [0x10, 0x05, crc8([0x10, 0x05])]);
  assert.equal(t.dati.length, 15);
  assert.equal(t.nibble.length, 52);
  assert.deepEqual(Array.from(t.nibble.subarray(0, 8)), [0, 15, 5, 10, 3, 12, 6, 9]);
  assert.deepEqual(P.leggiIntestazione(t.intestazione), { versione: 1, profilo: 0, lunghezza: 5, correzioni: 0 });
  assert.equal(P.leggiDati(t.dati, { profilo: 0, lunghezza: 5 }).testo, "Ciao!");
  // questi valori sono riportati nella specifica: se cambiano, il protocollo non è più compatibile
  assert.equal(Array.from(t.intestazione, (b) => b.toString(16).padStart(2, "0")).join(""), VETTORE.intestazione);
  assert.equal(Array.from(t.dati, (b) => b.toString(16).padStart(2, "0")).join(""), VETTORE.dati);
  assert.equal(t.toni.map((x) => x.frequenza).join(" "), VETTORE.frequenze);
});

test("Protocollo: andata e ritorno con testi casuali, anche accentati", () => {
  const rnd = casuale(99);
  for (let giro = 0; giro < 300; giro++) {
    const testo = testoCasuale(rnd);
    const t = P.componi(testo);
    const byte = P.nibbleInByte(t.nibble.subarray(P.ADDESTRAMENTO.length));
    const h = P.leggiIntestazione(byte.subarray(0, 7));
    assert.equal(h.lunghezza, t.carico.length);
    assert.equal(P.leggiDati(byte.subarray(7), h).testo, testo);
  }
});

test("Protocollo: errori corretti, errori gravi rifiutati, limiti del testo", () => {
  const rnd = casuale(5);
  const t = P.componi("Messaggio di prova per il Polpo");
  const h = { profilo: 0, lunghezza: t.carico.length };
  const guasta = (bytes, quanti) => {
    const c = Uint8Array.from(bytes);
    for (const p of rnd.scegli(c.length, quanti)) c[p] ^= 1 + rnd.intero(255);
    return c;
  };
  assert.equal(P.leggiIntestazione(guasta(t.intestazione, 2)).lunghezza, t.carico.length);
  assert.equal(P.leggiIntestazione(guasta(t.intestazione, 4)), null);
  const nsym = P.parita(t.carico.length + 2);
  const r = P.leggiDati(guasta(t.dati, nsym / 2), h);
  assert.equal(r.testo, "Messaggio di prova per il Polpo");
  assert.equal(r.errori, nsym / 2);
  assert.equal(P.leggiDati(guasta(t.dati, nsym / 2 + 3), h), null);
  assert.equal(P.leggiDati(t.dati, { profilo: 1, lunghezza: t.carico.length }), null, "il controllo lega dati e intestazione");
  assert.equal(P.leggiDati(t.dati.subarray(1), h), null);
  assert.throws(() => P.componi(""), P.ErroreMessaggio);
  assert.throws(() => P.componi("x".repeat(121)), P.ErroreMessaggio);
  assert.throws(() => P.componi("è".repeat(61)), P.ErroreMessaggio); // 122 byte in UTF-8
  assert.equal(P.componi("è".repeat(60)).carico.length, 120);
});

const VETTORE = {
  intestazione: "10054cf812f340",
  dati: "4369616f2153a7bf18a2e235889e35",
  frequenze:
    "1600 2050 2800 2650 1700 2350 2700 3150 2900 1750 1900 1750 3000 1950 1600 2650 2500 3150 3000 2750 2600 1950 1700 1750 2600 1850 " +
    "1700 2150 2400 3050 2700 2750 2100 2450 1700 2350 2500 2650 2200 3050 2200 1950 1700 3050 2900 2850 2500 2650 1700 2750 1800 2950",
};
