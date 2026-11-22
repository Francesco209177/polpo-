// Parità con protocols/ir.py e con la logica pura del modulo Infrarossi (app/tools/ir_tools.py).
import test from "node:test";
import assert from "node:assert/strict";
import * as I from "../../../assets/js/studio/protocolli/ir.js";
import { aFileIr, aSegnale, casi, daCodiceLibreria, daFileIr, daProtocollo, daSegnale, verificaCasi } from "./aiuto.mjs";

const C = casi("ir.json");

test("ir: costanti, protocolli, tasti, categorie e libreria", () => {
  assert.deepStrictEqual(
    { MAX_RAW_TIMINGS: I.MAX_TEMPI_RAW, MAX_RAW_TIMING_US: I.MAX_TEMPO_RAW_US, MAX_RAW_TOTAL_US: I.MAX_TOTALE_RAW_US },
    C.costanti,
  );
  assert.deepStrictEqual(
    Object.entries(I.PROTOCOLLI).map(([k, p]) => [k, daProtocollo(p)]),
    C.protocolli,
  );
  assert.deepStrictEqual({ ...I.TASTI }, C.tasti);
  assert.deepStrictEqual(Object.keys(I.TASTI), C.ordine_tasti);
  assert.deepStrictEqual({ ...I.CATEGORIE }, C.categorie);
  assert.deepStrictEqual(Object.keys(I.CATEGORIE), C.ordine_categorie);
  assert.deepStrictEqual(I.LIBRERIA.map(daCodiceLibreria), C.libreria);
  assert.deepStrictEqual(I.LIBRERIA.map((c) => daSegnale(c.segnale())), C.segnali_libreria);
  assert.deepStrictEqual(I.LIBRERIA.map((c) => c.segnale().valida()), C.valida_libreria);
});

const scrivi = (d) => I.scriviIr(aFileIr(d));

const gruppi = {
  protocollo: (n) => I.protocollo(n)?.nome ?? null,
  valida: (d) => aSegnale(d).valida(),
  argomenti_link: (d) => aSegnale(d).argomentiLink(),
  leggi: (t) => daFileIr(I.leggiIr(t)),
  scrivi,
  rilettura: (d) => daFileIr(I.leggiIr(scrivi(d))),
  marche: I.marche,
  codici: ([c, m]) => I.codici(c, m).map(daCodiceLibreria),
  ui_segnali_libreria: ([c, m]) => I.segnaliLibreria(c, m).map(daSegnale),
  ui_titolo_libreria: ([c, m]) => I.titoloLibreria(c, m),
  ui_nota: ([a, s]) => I.notaTelecomando(a, s),
  ui_descrivi: (d) => I.descriviSegnale(aSegnale(d)),
  ui_nome_file: I.nomeFileIr,
  ui_nome_copia: I.nomeCopiaTelecomando,
  ui_importa: (t) => I.messaggioImportazione(I.leggiIr(t)),
  ui_invio: (d) => I.preparaInvioIr(aSegnale(d)),
  ui_inviato: ([d, s]) => I.messaggioInviatoIr(aSegnale(d), s),
  ui_tasto_imparato: ([e, n, s]) => {
    const r = I.tastoImparato(e, n, s);
    return { ...r, segnale: r.segnale && daSegnale(r.segnale) };
  },
};

const fissi = ["costanti", "protocolli", "tasti", "ordine_tasti", "categorie", "ordine_categorie", "libreria", "segnali_libreria", "valida_libreria"];

test("ir.json: ogni gruppo ha la sua funzione JavaScript", () => {
  assert.deepStrictEqual(Object.keys(C).sort(), [...fissi, ...Object.keys(gruppi)].sort());
});

for (const [nome, fn] of Object.entries(gruppi)) {
  test(`ir: ${nome}`, () => {
    verificaCasi(C[nome], fn, nome);
  });
}
