// Parità di strumenti/console_seriale.js con devices/serial_console.py e la scheda «Console seriale» di gpio_tools.py
// (la finestra della console è il QPlainTextEdit vero di Qt, senza schermo).
import test from "node:test";
import assert from "node:assert/strict";
import * as S from "../../../assets/js/studio/strumenti/console_seriale.js";
import { B, ORA, casi, confronta, esito, J } from "./aiuto.mjs";

const C = casi("console_seriale");

test("console_seriale: menu delle velocità e dei fine riga, valori iniziali", () => {
  const M = C.menu;
  assert.deepStrictEqual(S.VELOCITA.map((b) => [String(b), b]), M.baud);
  assert.deepStrictEqual([...S.VELOCITA], M.costanti.BAUD_RATES);
  assert.ok(!S.VELOCITA.includes(S.BAUD_BOOTLOADER));
  assert.equal(String(S.VELOCITA_PREDEFINITA), M.baud_attuale);
  assert.deepStrictEqual({ ...S.FINE_RIGA }, M.costanti.LINE_ENDINGS);
  assert.deepStrictEqual(S.vociFineRiga(), M.fine_riga);
  assert.equal(Object.keys(S.FINE_RIGA).indexOf(S.FINE_RIGA_PREDEFINITA), M.fine_riga_attuale);
  assert.deepStrictEqual([S.TESTI.riavvia, true], M.riavvia);
  assert.deepStrictEqual([S.TESTI.esadecimale, false], M.esadecimale);
  assert.equal(S.TESTI.segnaposto, M.segnaposto);
  assert.equal(S.RIGHE_MAX, M.righe_max);
});

test("console_seriale: 1200 baud rifiutato, vista esadecimale", () => {
  confronta(C.velocita, (c) => esito(() => (S.controllaVelocita(c.baud), null)));
  confronta(C.hexdump, (c) => S.esadecimale(B(c.d)));
  assert.throws(() => S.opzioniApertura(1200), (e) => e.tipo === "ConsoleError" && e.message === S.MESSAGGIO_1200);
  assert.deepStrictEqual(S.opzioniApertura(115200), { baud: 115200, dtr: true, rts: true });
  assert.deepStrictEqual(S.opzioniApertura(9600, false), { baud: 9600, dtr: false, rts: false });
});

test("console_seriale: ciò che arriva, testo o esadecimale, con il limite di righe della finestra", () => {
  const n = confronta(C.ricevi, (c) => {
    const t = new S.Terminale(c.max);
    for (const p of c.pezzi) t.ricevi(B(p), c.esa);
    return J({ testo: t.testo, righe: t.righe });
  }, (c) => ({ testo: c.testo, righe: c.righe }));
  assert.ok(n >= 100);
});

test("console_seriale: ciò che si invia (testo più fine riga)", () => {
  confronta(C.invio, (c) => {
    if (c.testo === null) return [["avviso", S.TESTI.apriPrima, true]];
    return [["scritti", J(S.datiDaInviare(c.testo, c.fine))]];
  }, (c) => c.eventi);
  assert.throws(() => S.datiDaInviare("x", "TAB"), (e) => e.tipo === "KeyError" && e.message === "'TAB'");
  assert.throws(() => S.datiDaInviare("\ud800", "LF"), (e) => e.tipo === "UnicodeEncodeError");
});

test("console_seriale: messaggi di apertura e chiusura, salvataggio del registro", () => {
  const atteso = {
    apri_senza_porte: [["avviso", S.TESTI.nessunaPorta, true]],
    apri: [["console", "COM4", 115200, true], ["avviso", S.messaggioAperta("COM4", 115200), false]],
    apri_di_nuovo: [["chiusa"], ["avviso", S.TESTI.chiusa, false], ["console", "COM4", 115200, true], ["avviso", S.messaggioAperta("COM4", 115200), false]],
    chiudi: [["chiusa"], ["avviso", S.TESTI.chiusa, false]],
    chiudi_di_nuovo: [],
    invia_senza_console: [["avviso", S.TESTI.apriPrima, true]],
    apri_300_senza_riavvio: [["console", "COM4", 300, false], ["avviso", S.messaggioAperta("COM4", 300), false]],
    apri_errore: [["console", "COM4", 300, false], ["avviso", "Porta COM4 occupata da un altro programma", true]],
  };
  assert.deepStrictEqual(Object.fromEntries(C.sequenza.map((p) => [p.passo, p.eventi])), atteso);
  confronta(C.registro, (c) => {
    const t = new S.Terminale();
    t.aggiungi(c.testo);
    const s = S.salvataggioRegistro(t.testo, ORA);
    return s === null ? [] : [["messo", s.categoria, s.nome, new TextDecoder().decode(s.dati), {}], ["avviso", s.messaggio, false]];
  }, (c) => c.eventi);
});
