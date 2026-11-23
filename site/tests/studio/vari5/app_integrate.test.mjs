// Parità di strumenti/app_integrate.js con core/apps.py, core/capability.py e il modulo App (apps_tools.py) di Polpo
// Studio: manifest, permessi, compatibilità, catalogo filtrato, dettagli, apertura e interfaccia offerta alle app.
import test from "node:test";
import assert from "node:assert/strict";
import * as A from "../../../assets/js/studio/strumenti/app_integrate.js";
import { CATEGORIE } from "../../../assets/js/studio/sicurezza/cassaforte.js";
import { casi, confronta, esito } from "./aiuto.mjs";

const C = casi("app_integrate");
const K = C.costanti;
const NOMI = K.nomi_hardware;
// Il manifest letto da Python (dataclass) senza il percorso della cartella, che nel telefono non c'è.
const senzaPercorso = (m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== "path"));
const hw = (h) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k, { presenza: v, dettaglio: "" }]));

test("app_integrate: permessi, comandi, categorie, hardware, app integrate e testi del modulo", () => {
  assert.deepStrictEqual(Object.entries(A.PERMESSI), K.permessi);
  assert.deepStrictEqual(Object.fromEntries(Object.entries(A.COMANDI_PER_PERMESSO).map(([k, v]) => [k, [...v]])), K.comandi);
  assert.deepStrictEqual([...A.CATEGORIE_APP], K.categorie);
  assert.deepStrictEqual([...A.ID_HARDWARE], K.hardware);
  assert.deepStrictEqual([...CATEGORIE], K.cassaforte);
  assert.deepStrictEqual(A.MANIFEST_INTEGRATI.map((m) => ({ ...m })), K.integrate);
  assert.deepStrictEqual([...A.COLONNE], K.colonne);
  assert.deepStrictEqual([[A.TESTI.tutteLeCategorie, null], ...A.CATEGORIE_APP.map((c) => [c, c])], K.menu_categorie);
  assert.equal(A.TESTI.cerca, K.segnaposto);
  assert.ok(K.etichette.includes(A.TESTI.nota));
  // l'unica frase diversa dal programma per PC
  assert.equal(K.solo_software, "Funziona sul PC, non serve hardware.");
  assert.equal(A.MOTIVO_SOLO_SOFTWARE, "Funziona nel telefono, non serve hardware.");
  // nessun permesso concede trasmissioni o scritture
  for (const cmd of Object.values(A.COMANDI_PER_PERMESSO).flat()) assert.ok(!["rf.tx", "nfc.write_ndef", "fs.write", "fs.delete", "script.run"].includes(cmd), cmd);
});

test("app_integrate: lettura dei manifest (campi, errori, accorciamenti)", () => {
  const n = confronta(C.leggi, (c) => esito(() => A.leggiManifest(c.m, { integrata: c.integrata })), (c) => (c.r.ok ? { ok: senzaPercorso(c.r.ok) } : c.r));
  assert.ok(n > 300);
  assert.deepStrictEqual(A.appIntegrate().map((m) => m.id), ["convertitore", "calcolatore_crc", "tempo_radio", "costruttore_ndef"]);
  for (const m of A.appIntegrate()) assert.deepStrictEqual([m.builtin, A.valutaApp(m).etichetta, A.capacita(m).laboratorio], [true, "Disponibile", false]);
});

test("app_integrate: compatibilità con l'hardware (come capability.evaluate)", () => {
  confronta(C.valuta, (c) => A.valutaApp(senzaPercorso(c.m), hw(c.hw), NOMI), (c) => ({
    ...c.r,
    motivo: c.r.motivo === K.solo_software ? A.MOTIVO_SOLO_SOFTWARE : c.r.motivo,
  }));
});

test("app_integrate: catalogo filtrato, righe della tabella, dettagli", () => {
  const elenco = C.catalogo_elenco.map(senzaPercorso);
  const pieni = C.catalogo.filter((c) => c.ids.length).length;
  assert.ok(pieni >= 5, `solo ${pieni} ricerche con risultati`);
  confronta(C.catalogo, (c) => {
    const f = A.filtraApp(elenco, { categoria: c.categoria, cerca: c.cerca });
    return { ids: f.map((m) => m.id), righe: A.righeApp(f, hw(c.hw), NOMI) };
  }, (c) => ({ ids: c.ids, righe: c.righe }));
  confronta(C.dettagli, (c) => {
    const d = A.dettagliApp(senzaPercorso(c.m), NOMI, c.problemi);
    return [d.titolo, d.html];
  });
});

test("app_integrate: apertura e disinstallazione delle app integrate", () => {
  assert.deepStrictEqual(C.senza_selezione, [["avviso", A.TESTI.seleziona, true], ["avviso", A.TESTI.seleziona, true]]);
  const app = A.appIntegrate();
  confronta(C.apri, (c) => {
    const m = app.find((x) => x.id === c.id);
    return { titolo: A.titoloFinestra(m), eventi: [["attivita", ...A.attivitaApertura(m)], ["avviso", A.TESTI.nonDisinstallabili, true]] };
  }, (c) => ({ titolo: c.titolo, eventi: c.eventi }));
  assert.equal(A.titoloFinestra({ ...app[0], builtin: false }), "Convertitore · app di terze parti");
  assert.equal(A.messaggioErroreApertura(app[0], new Error("rotta")), "Impossibile aprire «Convertitore»: rotta");
});

test("app_integrate: comandi e cassaforte concessi alle app (AppApi)", () => {
  // le funzioni JavaScript controllano soltanto: se non lanciano, Python ha fatto la richiesta (che dà `ok`)
  const prova = (f, ok) => {
    const r = esito(f);
    return r.errore ? r : { ok };
  };
  confronta(C.api, (c) => {
    const m = senzaPercorso(c.m);
    const ogni = (chiavi, f, ok) => Object.fromEntries(chiavi.map((k) => [k, prova(() => f(k), ok)]));
    return {
      comandi: ogni(Object.keys(c.comandi), (k) => A.controllaComando(m, k), "inviato"),
      leggi: ogni(Object.keys(c.leggi), (k) => A.controllaCassaforte(m, k), []),
      prendi: ogni(Object.keys(c.prendi), (k) => A.controllaCassaforte(m, k), ""),
      metti: ogni(Object.keys(c.metti), (k) => A.controllaCassaforte(m, k, true), null),
    };
  }, (c) => ({ comandi: c.comandi, leggi: c.leggi, prendi: c.prendi, metti: c.metti }));
});
