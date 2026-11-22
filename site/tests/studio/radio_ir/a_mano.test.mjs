// Prove scritte a mano per ciò che è scomodo mettere nei vettori: errori, sicurezza, sorgenti, file veri.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as F from "../../../assets/js/studio/protocolli/flipper.js";
import * as I from "../../../assets/js/studio/protocolli/ir.js";
import * as S from "../../../assets/js/studio/protocolli/subghz.js";
import * as B from "../../../assets/js/studio/protocolli/budget_radio.js";

const MODULI = ["flipper.js", "ir.js", "subghz.js", "budget_radio.js"].map((n) => new URL(`../../../assets/js/studio/protocolli/${n}`, import.meta.url));
const testoIr = readFileSync(new URL("../../../../polpo/sd_template/polpo/ir/esempio_tv.ir", import.meta.url), "utf8");

test("sorgenti: nessuna API di rete, nessun indirizzo web, niente di solo Node", () => {
  for (const u of MODULI) {
    const s = readFileSync(u, "utf8");
    assert.doesNotMatch(s, /https?:\/\/|\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|RTCPeerConnection|importScripts)\b/, u.pathname);
    assert.doesNotMatch(s, /\b(Buffer|require|process)\b|node:/, u.pathname);
  }
});

test("errori: stessa gerarchia delle eccezioni Python e `tipo` col nome Python", () => {
  const e = new S.NonSupportato("x");
  assert.ok(e instanceof F.ErroreFormato && e instanceof F.ErroreValore && e instanceof F.ErrorePy && e instanceof Error);
  assert.equal(e.tipo, "Unsupported");
  assert.equal(new F.ErroreFormato("x").tipo, "FormatError");
  assert.equal(new F.ErroreValore("x").tipo, "ValueError");
  assert.equal(new F.ErroreOverflow("x").tipo, "OverflowError");
  assert.equal(new F.ErrorePy("x", "AttributeError").tipo, "AttributeError");
  assert.throws(() => S.leggiSub("Filetype: Flipper SubGhz Key File\nVersion: 1\nProtocol: KeeLoq\n"), {
    tipo: "Unsupported",
    message: "protocollo KeeLoq non supportato (solo codici fissi Princeton o RAW)",
  });
  assert.throws(() => I.leggiIr("Filetype: altro\nVersion: 1\n"), (x) => x instanceof F.ErroreFormato && !(x instanceof S.NonSupportato));
});

test("sicurezza: si trasmettono solo codici fissi in banda, con i controlli del Python", () => {
  const buono = S.leggiSub(S.TESTO_EDITOR_INIZIALE);
  assert.equal(S.controllaTrasmissibile(buono), "");
  buono.frequenza = 868_350_000;
  assert.match(S.controllaTrasmissibile(buono), /433,92/);
  const lungo = new S.FileSub({ codice: new S.CodiceRc(1, 33, 0, 350) });
  assert.equal(S.controllaTrasmissibile(lungo), "rc-switch trasmette al massimo 32 bit");
  for (const p of ["KeeLoq", "Nice FLO", "princeton", ""]) {
    const v = S.verificaTrasmissione(`Filetype: Flipper SubGhz Key File\nVersion: 1\nProtocol: ${p}\nKey: 01\n`);
    assert.equal(v.sub, null);
    assert.match(v.errore, /non supportato \(solo codici fissi Princeton o RAW\)$/);
  }
  const fuori = S.verificaTrasmissione(S.TESTO_EDITOR_INIZIALE.replace("433920000", "315000000"));
  assert.equal(fuori.errore, "Non trasmissibile: il modulo RF433T trasmette solo a 433,92 MHz (banda 433,05–434,79 MHz)");
  const ok = S.verificaTrasmissione(S.TESTO_EDITOR_INIZIALE);
  assert.equal(ok.errore, "");
  assert.deepStrictEqual(S.argomentiTrasmissione(S.percorsoTrasmissione("0123456789abcdef")), { file: "/polpo/rf433/pc_01234567.sub" });
  assert.deepStrictEqual(S.BANDE.at(-1), ["Disturbo radio, prove a forza bruta", "Escluso: illegale"]);
});

test("tabelle congelate e ricerca dei protocolli senza chiavi ereditate", () => {
  for (const k of ["constructor", "__proto__", "toString", "hasOwnProperty"]) assert.equal(I.protocollo(k), null);
  assert.equal(I.protocollo("Kaseikyo").nome, "Kaseikyo"); // il segno del kelvin diventa «k», come in Python
  assert.throws(() => {
    I.PROTOCOLLI.nec = null;
  }, TypeError);
  assert.throws(() => {
    I.LIBRERIA[0].indirizzo = 1;
  }, TypeError);
  assert.throws(() => {
    I.LIBRERIA.push(null);
  }, TypeError);
  assert.throws(() => {
    S.TABELLA_RC[0][0] = 9;
  }, TypeError);
  assert.equal(new I.Segnale("a").tempi === new I.Segnale("b").tempi, false);
});

test("il telecomando di esempio della microSD si legge e si riscrive uguale", () => {
  const f = I.leggiIr(testoIr);
  assert.equal(f.segnali.length, 6);
  assert.deepStrictEqual(f.avvisi, []);
  const di = (g) => g.segnali.map((s) => [s.nome, s.protocollo, s.indirizzo, s.comando, s.raw, s.tempi]);
  assert.deepStrictEqual(di(I.leggiIr(I.scriviIr(f))), di(f));
  assert.equal(f.segnali[0].argomentiLink().protocol, "Samsung32");
});

test("argomenti di Polpo Link: stesse chiavi e stesso ordine del Python", () => {
  assert.equal(JSON.stringify(new I.Segnale("a", { protocollo: "nec", indirizzo: 4, comando: 8 }).argomentiLink()), '{"protocol":"NEC","address":4,"command":8}');
  assert.equal(
    JSON.stringify(new I.Segnale("a", { raw: true, tempi: [9000, 4500] }).argomentiLink()),
    '{"raw":true,"frequency":38000,"duty":0.33,"timings":[9000,4500]}',
  );
  const s = new I.Segnale("a", { raw: true, tempi: [1, 2] });
  s.argomentiLink().timings.push(3); // è una copia, come list(self.timings)
  assert.deepStrictEqual(s.tempi, [1, 2]);
  assert.deepStrictEqual(I.COMANDI_IR, { invia: "ir.send", avviaApprendimento: "ir.learn.start", fermaApprendimento: "ir.learn.stop", eventoImparato: "ir.learned" });
});

test("byte ⇄ testo come Python: il BOM resta, i surrogati spaiati non si codificano", () => {
  const conBom = Uint8Array.of(0xef, 0xbb, 0xbf, ...new TextEncoder().encode(testoIr));
  assert.throws(() => I.leggiIr(F.testoDaByte(conBom)), { tipo: "FormatError", message: "manca l'intestazione Filetype" });
  assert.equal(I.leggiIr(new TextDecoder().decode(conBom)).segnali.length, 6); // il TextDecoder predefinito toglierebbe il BOM
  assert.throws(() => F.byteDaTesto("a\ud800"), { tipo: "UnicodeEncodeError" });
  assert.deepStrictEqual(Array.from(F.byteDaTesto("è")), [0xc3, 0xa8]);
});

test("interi grandi restano esatti (BigInt) e si riscrivono identici", () => {
  const t = "Filetype: Flipper SubGhz RAW File\nVersion: 1\nFrequency: 99999999999999999999\nKey: FF FF FF FF FF FF FF FF\nProtocol: RAW\nRAW_Data: 123456789012345678901 -1\n";
  const f = S.leggiSub(t);
  assert.equal(f.frequenza, 99999999999999999999n);
  assert.equal(f.codice.valore, 0xffffffffffffffffn);
  assert.deepStrictEqual(f.tempiRaw, [123456789012345678901n, -1]);
  assert.equal(f.inBanda, false);
  assert.match(S.scriviSub(f), /^Frequency: 99999999999999999999$/m);
  assert.match(S.scriviSub(f), /^RAW_Data: 123456789012345678901 -1$/m);
  assert.equal(F.leggiFf("Filetype: x\nVersion: 007\n").versione, 7);
});

test("aiuti dell'interfaccia: non modificano i dati ricevuti", () => {
  const tempi = [-500, -20, 350, -1050];
  const r = S.rawDaSalvare(tempi);
  assert.deepStrictEqual(tempi, [-500, -20, 350, -1050]);
  assert.deepStrictEqual(r.sub.tempiRaw, [350, -1050]);
  assert.equal(S.rawDaSalvare([-1]).errore, "Niente di valido da salvare: registra prima qualche impulso.");
  const evento = { protocol: 1, bits: 24, value: "0000000000515A01", pulse_us: 350, simulated: true };
  assert.deepStrictEqual(S.rigaCodiceRicevuto(evento, false), { protocollo: "1", bit: "24", codice: "0x515A01", impulso: "350 µs", origine: "SIMULATO" });
  assert.equal(S.nomeCodiceRicevuto(evento), "codice 515A01");
  assert.deepStrictEqual(Object.keys(evento), ["protocol", "bits", "value", "pulse_us", "simulated"]);
  const imparato = I.tastoImparato({ protocol: "NEC", address: 4, command: 8, simulated: true }, 3, false);
  assert.equal(imparato.messaggio, "Imparato «tasto 3» (NEC). Rinominalo dal file se vuoi.");
  assert.equal(imparato.simulato, true);
});

test("report radio: data nel formato del Python e niente HTML non sfuggito", () => {
  assert.equal(S.dataReport(new Date(2026, 10, 22, 8, 5)), "22/11/2026 08:05");
  const html = S.reportRadio(
    [{ nome: "<presa>", testo: S.TESTO_EDITOR_INIZIALE, meta: { device: "a" }, simulato: false, sha256: "ab".repeat(32) }],
    [{ id: "a", name: "salotto & cucina" }],
    "22/11/2026 08:05",
  );
  assert.match(html, /<td>&lt;presa&gt;<\/td><td>salotto &amp; cucina<\/td><td>rc-switch 1 · 24 bit · 350 µs<\/td><td>reale<\/td><td><tt>abababababababab<\/tt><\/td>/);
  assert.match(html, /Creato il 22\/11\/2026 08:05 con Polpo Studio/);
});

test("formati numerici di Python dove JavaScript farebbe diversamente", () => {
  assert.equal(F.virgolaFissa(1 / 128, 6), "0.007812"); // toFixed darebbe 0.007813
  assert.equal(F.virgolaFissa(-0, 6), "-0.000000");
  assert.equal(F.virgolaFissa(0.25, 1), "0.2");
  assert.equal(F.reprDecimale(1e-5), "1e-05");
  assert.equal(F.reprDecimale(1e16), "1e+16");
  assert.equal(F.divisioneIntera(1, 0.1), 9); // Math.floor(1 / 0.1) darebbe 10
  assert.equal(F.testoPy(5), "5");
  assert.equal(F.testoPy(null), "None");
  assert.equal(B.testoStima(1, 24, 350, 4), "Un invio dura circa 179.2 ms. Nel limite di 288 s all'ora ne rientrano circa 1607.");
});
