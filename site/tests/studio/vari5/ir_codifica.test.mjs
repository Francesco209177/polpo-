// Parità della codifica infrarossi (ir_codifica.js) con il codice C++ del firmware (ir_encode, ir_total_us, tabella dei
// protocolli), sui casi generati da site/tests/studio/casi/genera_ir_codifica.py compilando polpo_core.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as C from "../../../assets/js/studio/protocolli/ir_codifica.js";
import { PROTOCOLLI, Segnale } from "../../../assets/js/studio/protocolli/ir.js";
import { confronta } from "./aiuto.mjs";

const CASI = JSON.parse(readFileSync(new URL("../casi/ir_codifica/ir_codifica.json", import.meta.url), "utf8"));
const numeri = (t) => (t === "" ? [] : t.split(" ").map(Number));
// Il risultato nella forma dei casi: i tempi come testo, il duty come il float a 32 bit del firmware.
const forma = (r) => (r === null ? null : { frequenza: r.frequenza, duty: Math.fround(r.duty), tempi: r.tempi.join(" ") });

test("ir_codifica: tabella dei protocolli come ir_signal.cpp", () => {
  const js = [...C.PARAMETRI, C.SCONOSCIUTO].map((p, n) => ({
    n, nome: p.nome, bit_indirizzo: p.bitIndirizzo, bit_comando: p.bitComando, frequenza: p.frequenza, duty: Math.fround(p.duty),
    frame_minimi: p.frameMinimi, pausa_frame_us: p.pausaFrameUs,
  }));
  assert.deepStrictEqual(js, CASI.protocolli);
  // stessi bit e portanti della tabella di ir.js (protocols/ir.py)
  for (const p of C.PARAMETRI) {
    const q = PROTOCOLLI[p.nome.toLowerCase()];
    assert.deepStrictEqual([q.nome, q.bitIndirizzo, q.bitComando, q.frequenza], [p.nome, p.bitIndirizzo, p.bitComando, p.frequenza]);
  }
  assert.equal(Object.keys(PROTOCOLLI).length, C.PARAMETRI.length);
  assert.deepStrictEqual([C.MAX_TEMPI_RAW, C.MAX_TEMPO_RAW_US, C.MAX_TOTALE_RAW_US], [1024, 100000, 2000000]);
});

test("ir_codifica: nomi dei protocolli come ir_protocol_from_name", () => {
  confronta(CASI.nomi, (c) => C.indiceProtocollo(c.nome));
});

test("ir_codifica: segnali «parsed» come ir_encode (tutti i protocolli, toggle sì/no)", () => {
  const n = confronta(CASI.parsed, (c) => forma(C.codificaIr(new Segnale("prova", { protocollo: c.p, indirizzo: c.a, comando: c.c }), c.t)));
  assert.ok(n > 1000, `solo ${n} casi`);
  // anche con indirizzo e comando BigInt
  confronta(CASI.parsed.slice(0, 50), (c) => forma(C.codificaIr(new Segnale("prova", { protocollo: c.p, indirizzo: BigInt(c.a), comando: BigInt(c.c) }), c.t)));
});

test("ir_codifica: segnali RAW come ir_encode", () => {
  confronta(CASI.raw, (c) => forma(C.codificaIr(new Segnale("prova", { raw: true, frequenza: c.f, duty: c.d, tempi: numeri(c.tempi) }))));
});

test("ir_codifica: durata totale come ir_total_us", () => {
  confronta(CASI.totali, (c) => C.totaleUs(numeri(c.tempi)));
});

test("ir_codifica: valori che il firmware non può ricevere", () => {
  const s = (o) => new Segnale("x", { protocollo: "NEC", ...o });
  assert.equal(C.codificaIr(s({ indirizzo: -1 })), null);
  assert.equal(C.codificaIr(s({ comando: 2 ** 32 })), null);
  assert.equal(C.codificaIr(s({ indirizzo: 1.5 })), null);
  assert.equal(C.codificaIr(s({ indirizzo: "4" })), null);
  assert.equal(C.codificaIr(s({ protocollo: 5 })), null);
  assert.equal(C.codificaIr(new Segnale("x", { raw: true, tempi: [100, -5, 100] })), null);
  assert.equal(C.codificaIr(new Segnale("x", { raw: true, tempi: [100, 2.5, 100] })), null);
  assert.notEqual(C.codificaIr(new Segnale("x", { raw: true, tempi: [100n, 200, 100] })), null);
  // il toggle cambia solo RC5, RC5X e RC6
  for (const p of C.PARAMETRI) {
    const [a, b] = [false, true].map((t) => C.codificaIr(new Segnale("x", { protocollo: p.nome, indirizzo: 3, comando: 9 }), t).tempi.join(" "));
    assert.equal(a !== b, ["RC5", "RC5X", "RC6"].includes(p.nome), p.nome);
  }
});

test("ir_codifica: preparazione per l'emettitore del telefono (limiti di android/PONTE.md)", () => {
  const nec = new Segnale("Accendi", { protocollo: "NEC", indirizzo: 4, comando: 8 });
  const r = C.preparaTrasmissioneTelefono(nec);
  assert.equal(r.errore, "");
  assert.equal(r.frequenza, 38000);
  assert.deepStrictEqual(r.tempi, C.codificaIr(nec).tempi);
  assert.equal(r.tempi.length % 2, 1);
  assert.deepStrictEqual(C.preparaTrasmissioneTelefono(new Segnale("x", { protocollo: "NEC", indirizzo: 256 })).errore, "indirizzo troppo grande per NEC");
  assert.equal(C.preparaTrasmissioneTelefono(new Segnale("x", { protocollo: "Boh" })).errore, "protocollo sconosciuto");
  assert.equal(C.preparaTrasmissioneTelefono(new Segnale("", { protocollo: "NEC" })).errore, "nome mancante");
  // ir.js accetta il segno Kelvin (come Python), il firmware no
  assert.equal(C.preparaTrasmissioneTelefono(new Segnale("x", { protocollo: "\u212Aaseikyo" })).errore, "segnale non codificabile");
  const raw = (f, t) => C.preparaTrasmissioneTelefono(new Segnale("r", { raw: true, frequenza: f, tempi: t }));
  assert.equal(raw(38000, [500, 500, 500]).errore, "");
  assert.equal(raw(15000, [500, 500, 500]).errore, "portante fuori dalla portata dell'emettitore del telefono (20-60 kHz)");
  assert.equal(raw(60001, [500]).errore, "portante fuori dalla portata dell'emettitore del telefono (20-60 kHz)");
  assert.equal(raw(60000, [500]).errore, "");
  assert.equal(raw(20000, [500]).errore, "");
  assert.equal(C.controllaPerTelefono({ frequenza: 38000, tempi: new Array(1025).fill(10) }), "troppi tempi per il telefono (max 1024)");
  assert.equal(C.controllaPerTelefono({ frequenza: 38000, tempi: [1_000_000, 1_000_001] }), "segnale troppo lungo per il telefono (max 2 s)");
  assert.equal(C.controllaPerTelefono({ frequenza: 38000, tempi: [] }), "nessun tempo da trasmettere");
  // SIRC: tre frame, sempre entro i limiti
  const sirc = C.preparaTrasmissioneTelefono(new Segnale("Sony", { protocollo: "SIRC20", indirizzo: 0x1fff, comando: 0x7f }));
  assert.equal(sirc.errore, "");
  assert.equal(sirc.frequenza, 40000);
});

test("ir_codifica: alternanza del toggle come il firmware", () => {
  const rc5 = new Segnale("Accendi", { protocollo: "RC5", indirizzo: 0, comando: 12 });
  const g = new C.AlternanzaToggle();
  const a = g.prepara(rc5);
  const b = g.prepara(rc5);
  const c = g.prepara(rc5);
  assert.deepStrictEqual(a.tempi, C.codificaIr(rc5, false).tempi);
  assert.deepStrictEqual(b.tempi, C.codificaIr(rc5, true).tempi);
  assert.deepStrictEqual(c.tempi, a.tempi);
  const prima = g.toggle;
  assert.notEqual(g.prepara(new Segnale("x", { protocollo: "RC5", indirizzo: 99 })).errore, "");
  assert.equal(g.toggle, prima, "un segnale rifiutato non cambia il toggle");
});
