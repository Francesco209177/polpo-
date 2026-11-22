// Parità con protocols/subghz.py e con la logica pura del modulo Radio 433 MHz (app/tools/radio_tools.py).
import test from "node:test";
import assert from "node:assert/strict";
import * as S from "../../../assets/js/studio/protocolli/subghz.js";
import { aCodice, aFileSub, casi, daFileSub, daStatistiche, verificaCasi } from "./aiuto.mjs";

const C = casi("subghz.json");

test("subghz: costanti, tabella rc-switch, file predefinito, bande", () => {
  assert.deepStrictEqual(
    {
      KEY_TYPE: S.TIPO_CHIAVE,
      RAW_TYPE: S.TIPO_RAW,
      RAW_MAX_PER_LINE: S.RAW_MAX_PER_RIGA,
      RAW_MAX_TIMINGS: S.RAW_MAX_TEMPI,
      BAND_MIN: S.BANDA_MIN,
      BAND_MAX: S.BANDA_MAX,
      RC_PROTOCOLS: S.RC_PROTOCOLLI,
      RC_MAX_BITS: S.RC_MAX_BIT,
      DEFAULT_PRESET: S.PRESET_PREDEFINITO,
      RC_TABLE: S.TABELLA_RC.map((r) => [...r]),
      predefinito: daFileSub(new S.FileSub()),
    },
    C.costanti,
  );
  assert.equal(S.TESTO_EDITOR_INIZIALE, C.ui_testo_editor);
  assert.deepStrictEqual(S.BANDE.map((r) => [...r]), C.bande);
  assert.equal(S.NOTA_BANDE, C.nota_bande);
});

const conSub = (r) => ({ ...r, sub: r.sub && daFileSub(r.sub) });

const gruppi = {
  raw_valido: S.rawValido,
  leggi: (t) => daFileSub(S.leggiSub(t)),
  scrivi: (d) => S.scriviSub(aFileSub(d)),
  trasmissibile: (d) => S.controllaTrasmissibile(aFileSub(d)),
  analizza: (t) => {
    const st = S.analizzaImpulsi(t);
    return { ...daStatistiche(st), guess: S.ipotesiProtocollo(st) };
  },
  ipotesi: (d) => {
    const st = new S.StatisticheImpulsi();
    st.conteggio = d.count;
    st.rapporto = d.ratio;
    st.breveUs = d.short_us;
    return S.ipotesiProtocollo(st);
  },
  tempo_aria: ([p, b, imp, rip]) => S.tempoInAriaRcUs(new S.CodiceRc(p, b, 0, imp), rip),
  codice_in_sub: ([p, b, v, imp]) => daFileSub(S.codiceInSub(p, b, v, imp)),
  ui_riga_codice: ([e, s]) => S.rigaCodiceRicevuto(e, s),
  ui_sub_evento: (e) => daFileSub(S.subDaEvento(e)),
  ui_nome_codice: S.nomeCodiceRicevuto,
  ui_salva_codice: ([e, s, nome, dev]) => S.salvataggioCodice(e, s, nome, dev),
  ui_istantanea: S.tempiDaInstantanea,
  ui_raw_da_salvare: (t) => conSub(S.rawDaSalvare(t)),
  ui_analisi: S.testoAnalisi,
  ui_didascalia: S.didascaliaImpulsi,
  ui_archivio: S.descriviArchivio,
  ui_codice_fisso: (d) => S.testoCodiceFisso(aCodice(d)),
  ui_nome_dispositivo: ([d, id]) => S.nomeDispositivo(d, id),
  ui_verifica: (t) => conSub(S.verificaTrasmissione(t)),
  ui_percorso: S.percorsoTrasmissione,
  ui_conferma: ([n, m, d]) => S.confermaTrasmissione(n, m, d),
  ui_trasmesso: ([d, s]) => S.testoTrasmesso(d, s),
  ui_dettagli: S.dettagliReport,
  ui_report: ([v, d, q]) => S.reportRadio(v, d, q),
  ui_stato_editor: S.statoEditor,
  ui_nome_file_sub: S.nomeFileSub,
  ui_salva_editor: ([t, n]) => S.salvataggioEditor(t, n),
};

const fissi = ["costanti", "ui_testo_editor", "bande", "nota_bande"];

test("subghz.json: ogni gruppo ha la sua funzione JavaScript", () => {
  assert.deepStrictEqual(Object.keys(C).sort(), [...fissi, ...Object.keys(gruppi)].sort());
});

for (const [nome, fn] of Object.entries(gruppi)) {
  test(`subghz: ${nome}`, () => {
    verificaCasi(C[nome], fn, nome);
  });
}
