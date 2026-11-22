// NDEF e tag Type 2: stessi byte e stesse analisi di studio/polpo_studio/protocols/ndef.py e type2.py.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as ndef from "../../../assets/js/studio/protocolli/ndef.js";
import * as type2 from "../../../assets/js/studio/protocolli/type2.js";
import { hexPy } from "../../../assets/js/studio/strumenti/convertitore.js";
import { B, casi, confronta, D, esito } from "./aiuto.mjs";

const N = casi("ndef");
const T2 = casi("type2");

/** Un record nella forma del generatore (nomi dei campi Python). */
export const recordPy = (r) => ({ tnf: r.tnf, type: hexPy(r.tipo), payload: hexPy(r.payload), kind: r.genere, value: r.valore, lang: r.lingua });

const modelloPy = (m) =>
  m && { name: m.nome, total_pages: m.pagineTotali, user_first: m.primaUtente, user_last: m.ultimaUtente, dyn_lock_page: m.paginaBloccoDinamico, cfg_page: m.paginaCfg };

/** Un'analisi nella forma del generatore. */
export const analisiPy = (a) => ({
  uid: a.uid,
  model: a.modello,
  family: a.famiglia,
  uid_ok: a.uidOk,
  ndef_formatted: a.formattatoNdef,
  cc_version: a.versioneCc,
  capacity: a.capacita,
  writable: a.scrivibile,
  static_locked: a.bloccatoStatico,
  otp: a.otp,
  records: a.record.map(recordPy),
  ndef_error: a.erroreNdef,
  notes: a.note,
});

test("record URI: prefisso più lungo, UTF-8, record lunghi", () => {
  confronta(N.uri_message, (c) => esito(() => ndef.messaggioUri(D(c.uri))));
});

test("record di testo con la lingua", () => {
  confronta(N.text_message, (c) => esito(() => ndef.messaggioTesto(D(c.testo), c.lingua)));
});

test("involucro TLV e ricerca del messaggio nel TLV", () => {
  confronta(N.wrap_tlv, (c) => hexPy(ndef.avvolgiTlv(B(c.m))));
  confronta(N.find_in_tlv, (c) => {
    const m = ndef.trovaNelTlv(B(c.mem));
    return m === null ? null : hexPy(m);
  });
});

test("analisi dei messaggi NDEF (validi, troncati, casuali)", () => {
  confronta(N.parse, (c) => esito(() => ndef.analizza(B(c.m)), (rs) => rs.map(recordPy)));
});

test("i prefissi URI dello standard, senza indirizzi scritti per intero nel sorgente", () => {
  assert.equal(ndef.PREFISSI_URI.length, 36);
  assert.equal(ndef.PREFISSI_URI[4], "https" + "://");
  assert.equal(hexPy(ndef.messaggioUri("https" + "://example.org")), "d1010c55046578616d706c652e6f7267");
});

test("Type 2: modello dalla versione, dal nome, famiglia da SAK/ATQA", () => {
  confronta(T2.model_from_version, (c) => modelloPy(type2.modelloDaVersione(B(c.v))));
  confronta(T2.model_by_name, (c) => modelloPy(type2.modelloDaNome(c.n)));
  confronta(T2.card_family, (c) => type2.famigliaCarta(c.sak, c.atqa));
});

test("Type 2: analisi delle letture nfc.read", () => {
  confronta(T2.analyze, (c) => esito(() => analisiPy(type2.analizzaLettura(c.card)), (x) => x));
});
