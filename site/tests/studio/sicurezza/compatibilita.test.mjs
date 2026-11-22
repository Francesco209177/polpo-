// Compatibilità con Polpo Studio in Python, nei due sensi: cassaforti, backup .polpobak e registro aperti da
// entrambe le parti, con gli stessi problemi trovati sugli stessi file alterati.
// Servono l'interprete Python con polpo_studio installato in POLPO_PYTHON; senza, queste prove vengono saltate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import path from "node:path";
import * as C from "../../../assets/js/studio/sicurezza/cripto.js";
import * as F from "../../../assets/js/studio/sicurezza/formati.js";
import { Cassaforte } from "../../../assets/js/studio/sicurezza/cassaforte.js";
import { ArchivioMemoria } from "../../../assets/js/studio/sicurezza/archivio.js";
import { esportaBackup, importaBackup, leggiBackup } from "../../../assets/js/studio/sicurezza/backup.js";
import { RegistroSicuro } from "../../../assets/js/studio/sicurezza/registro_sicuro.js";
import { ArchivioCartella, SENZA_PYTHON, base64, cartellaTemporanea, daBase64, esa, python, testo } from "./aiuto.mjs";

const VELOCE = 2 ** 10;
const FRASE = "una frase abbastanza lunga";
const salta = { skip: SENZA_PYTHON };

/** Voci di prova: nomi e metadati con accenti ed emoji, dati binari, vuoti e più grandi. */
function vociDiProva() {
  const grande = F.casuali(300_000);
  return [
    { category: "nfc", name: "tag cucina", data: base64(Uint8Array.from([1, 2, 3])), meta: { uid: "04A1", "nota": "è mio 🐙", annidato: { lista: [1, 2.5, true, null], n: -7 } } },
    { category: "radio", name: "presa «salotto» 433,92 MHz", data: base64(F.casuali(1000)), origin: "simulato", meta: { raw: true } },
    { category: "ir", name: "telecomando.ir", data: base64(testo("Filetype: IR signals file\n")), meta: {} },
    { category: "altro", name: "vuoto", data: base64(new Uint8Array(0)) },
    { category: "backup", name: "grande.bin", data: base64(grande), meta: { righe: "a\nb\tc\u0001" } },
    { category: "diagnostica", name: "da togliere", data: base64(testo("x")) },
  ];
}

const registroDiProva = (n, da = 0) =>
  Array.from({ length: n }, (_, i) => ({ ts: 1795375800.25 + i, category: "test", message: `voce ${da + i} — è così 🐙`, level: i % 2 ? "ok" : "info", simulated: i === 1 }));

/** Una voce JavaScript nel formato del dizionario Python. */
const comePython = (v) => ({ id: v.id, category: v.categoria, name: v.nome, created: v.creato, modified: v.modificato, version: v.versione, size: v.dimensione, sha256: v.sha256, origin: v.origine, meta: v.meta });
const senzaDati = ({ data, ...resto }) => resto;

async function vociJs(c) {
  const out = [];
  for (const v of c.voci()) out.push({ ...comePython(v), data: base64(await c.leggi(v.id)) });
  return out;
}

/** Varianti alterate delle righe di un registro, per confrontare le verifiche delle due versioni. */
function manomissioni(righe) {
  const cambiata = JSON.parse(righe[1]);
  cambiata.c = cambiata.c.slice(0, -4) + "AAAA";
  const prevSbagliato = JSON.parse(righe[2]);
  prevSbagliato.prev = "f".repeat(64);
  return {
    tolta: [...righe.slice(0, 2), ...righe.slice(3)],
    tagliate: righe.slice(0, 2),
    cambiata: [righe[0], JSON.stringify(cambiata), ...righe.slice(2)],
    scambiate: [righe[1], righe[0], ...righe.slice(2)],
    illeggibile: [righe[0], "non è json", "[1, 2]", '{"seq": "x", "c": "", "prev": "", "mac": ""}', ...righe.slice(1)],
    prev: [...righe.slice(0, 2), JSON.stringify(prevSbagliato), ...righe.slice(3)],
    vuoto: [],
    integro: righe,
  };
}

async function confrontaManomissioni(t, cartella, n, frase) {
  const file = path.join(cartella, "registro.log");
  const righe = readFileSync(file, "utf-8").split("\n").filter(Boolean);
  const originale = readFileSync(file);
  for (const [nome, varianti] of Object.entries(manomissioni(righe))) {
    writeFileSync(file, varianti.map((r) => r + "\n").join(""));
    const c = await Cassaforte.apri(new ArchivioCartella(cartella));
    await c.sblocca(frase);
    const js = await (await RegistroSicuro.apri(c)).verifica();
    const py = python("registro", { cartella, n, frase }).problemi;
    assert.deepEqual(js, py, `manomissione «${nome}»`);
    if (nome === "integro") assert.deepEqual(js, []);
    else assert.ok(js.length > 0, nome);
  }
  writeFileSync(file, originale);
}

/** Varianti alterate degli oggetti: stesse segnalazioni da JavaScript e da Python. */
async function confrontaOggetti(cartella, n, frase) {
  const c = await Cassaforte.apri(new ArchivioCartella(cartella));
  await c.sblocca(frase);
  const [a, b, d] = c.voci();
  const ogg = (id) => path.join(cartella, "oggetti", id);
  const vecchio = readFileSync(ogg(a.id));
  await c.aggiorna(a.id, { dati: testo("nuova versione") });
  writeFileSync(ogg(a.id), vecchio); // ritorno alla versione vecchia
  copyFileSync(ogg(d.id), ogg(b.id)); // scambio
  const rotto = readFileSync(ogg(d.id));
  rotto[rotto.length - 1] ^= 1;
  writeFileSync(ogg(d.id), rotto);
  writeFileSync(ogg("estraneo"), "x");
  const js = (await c.verifica()).map((p) => [p.idVoce, p.cosa]).sort();
  const py = python("apri", { cartella, n, frase }).problemi;
  assert.deepEqual(js, py);
  assert.equal(js.length, 4);
  // e un file mancante
  rmSync(ogg(a.id));
  assert.deepEqual((await c.verifica()).map((p) => [p.idVoce, p.cosa]).sort(), python("apri", { cartella, n, frase }).problemi);
}

// ---------------- primitive ----------------

test("primitive e formati: stessi risultati di Python", salta, async () => {
  const k = F.casuali(32);
  const sale = F.casuali(16);
  const dati = F.casuali(100);
  const aad = testo("polpo-obj|abc|def|1");
  const sigillatoJs = await C.sigilla(k, dati, aad);
  const rotto = sigillatoJs.slice();
  rotto[20] ^= 1;
  const recupero = [C.nuovaChiaveRecupero(), "abcd efgh ijkl mnop qrst uvwx yz23 4567", "0000-1111-8888-AAAA-BBBB-CCCC-DDDD-EEEE", "ABCD", "9999-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA", "aaaa\taaaa\naaaa-aaaa aaaa-aaaa-aaaa-aaaa", "ÀAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA", "ßAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AA"];
  const frasi = ["corta", "cavallo batteria graffetta", "aaaaaaaaaaaaaaaa", "PASSWORD1234", "🐙🐙🐙🐙🐙🐙🐙🐙🐙🐙🐙🐙", "abcdef ghijkl", ""];
  const json = [
    '{"a": 1.5, "b": 0.0001, "c": 1e-05, "d": 1.5e-07, "e": 123456789.123, "f": -3, "g": 9007199254740991, "h": 1e+22, "i": 5e-324}',
    '{"testo": "\\u00e8\\u007f\\u2028\\u2029\\u0001\\b\\f\\n\\r\\t\\"\\\\/\\ud83d\\ude00 àèìòù € 🐙", "vuoti": [{}, [], ""], "x": [true, false, null]}',
    '{"annidato": {"a": [1, {"b": [2, [3, {}]]}], "chiave con spazi e \\u00e8": 0}}',
    '[1795375809.923, 1732300000.1234567, 0.1, 0.30000000000000004, -2.5e-8, 1e300]',
  ];
  const b64 = ["", "QQ==", "QQ=", "QQ", "QUI=", "QUJ=", "QUJD", "QUJDR", "Q===", "QQ==QQ==", "QU JD", "QUJD\n", "AB==", "ABC=", "QUJD=", "=", "+/+/", "-_-_"];
  const r = python("vettori", {
    hkdf: [[base64(k), "index"], [base64(k), "ext|registro-hmac"], [base64(k), "èà 🐙"], [base64(new Uint8Array(0)), ""]],
    scrypt: [[base64(testo("password")), base64(testo("NaCl")), 1024, 8, 16], [base64(testo(FRASE)), base64(sale), 1024, 8, 1], [base64(new Uint8Array(0)), base64(new Uint8Array(0)), 16, 1, 1]],
    mac: [[base64(k), base64(dati)], [base64(k), base64(new Uint8Array(0))]],
    sha256: [base64(dati), base64(new Uint8Array(0))],
    sigilla: [[base64(k), base64(dati), base64(aad)]],
    dissigilla: [[base64(k), base64(sigillatoJs), base64(aad)], [base64(k), base64(rotto), base64(aad)], [base64(k), base64(sigillatoJs.subarray(0, 27)), base64(aad)]],
    recupero,
    frasi,
    json,
    base64: b64,
  });
  assert.equal(esa(await C.hkdf(k, "index")), r.hkdf[0]);
  assert.equal(esa(await C.hkdf(k, "ext|registro-hmac")), r.hkdf[1]);
  assert.equal(esa(await C.hkdf(k, "èà 🐙")), r.hkdf[2]);
  assert.equal(esa(await C.hkdf(new Uint8Array(0), "")), r.hkdf[3]);
  assert.equal(esa(await C.deriva(testo("password"), testo("NaCl"), 1024, 8, 16)), r.scrypt[0]);
  assert.equal(esa(await C.deriva(testo(FRASE), sale, 1024)), r.scrypt[1]);
  assert.equal(esa(await C.deriva(new Uint8Array(0), new Uint8Array(0), 16, 1, 1)), r.scrypt[2]);
  assert.equal(await C.mac(k, dati), r.mac[0]);
  assert.equal(await C.mac(k, new Uint8Array(0)), r.mac[1]);
  assert.deepEqual([await C.sha256(dati), await C.sha256(new Uint8Array(0))], r.sha256);
  assert.deepEqual(await C.dissigilla(k, daBase64(r.sigillati[0]), aad), dati); // Python → JavaScript
  assert.deepEqual(r.dissigillati, [base64(dati), "IntegrityError: autenticazione fallita", "IntegrityError: dati troppo corti"]); // JavaScript → Python
  assert.deepEqual(recupero.map((t) => { const g = C.normalizzaChiaveRecupero(t); return g && esa(g); }), r.recupero);
  for (const k2 of r.nuove_chiavi) assert.equal(C.normalizzaChiaveRecupero(k2).length, 20);
  assert.deepEqual(frasi.map(C.problemiFrase), r.frasi);
  json.forEach((t, i) => {
    const x = JSON.parse(t);
    assert.deepEqual([F.jsonPython(x), F.jsonPython(x, { soloAscii: false }), F.jsonPython(x, { rientro: 2 })], r.json[i], t);
  });
  assert.deepEqual(b64.map((s) => { try { return esa(F.daBase64(s)); } catch { return null; } }), r.base64);
});

// ---------------- Python → JavaScript ----------------

test("cassaforte, registro e backup creati da Python: JavaScript li apre, li verifica e li modifica", salta, async (t) => {
  const { cartella: base, pulisci } = cartellaTemporanea();
  t.after(pulisci);
  const cartella = path.join(base, "cassaforte");
  const fileBackup = path.join(base, "copia.polpobak");
  const creata = python("crea", {
    cartella, n: VELOCE, frase: FRASE, voci: vociDiProva(),
    aggiornamenti: [{ indice: 0, data: base64(testo("versione 2")), meta: { uid: "04A1", nuovo: "sì" } }, { indice: 2, name: "telecomando rinominato.ir", mark_simulated: true }],
    elimina: [5],
    pin: "2468",
    registro: registroDiProva(4),
    backup: { file: fileBackup, password: "password-backup", n: VELOCE },
  });
  assert.equal(creata.quanti, 5);

  // apertura, elenco, lettura, verifica
  const c = await Cassaforte.apri(new ArchivioCartella(cartella));
  assert.ok(c.esiste && c.id === creata.id);
  assert.deepEqual(c.parametriKdf, { alg: "scrypt", n: VELOCE, r: 8, p: 1 });
  await assert.rejects(c.sblocca("frase sbagliata!"), (e) => e.codice === "wrong");
  await c.sblocca(FRASE);
  assert.deepEqual(await vociJs(c), creata.voci);
  assert.equal(c.voci().find((v) => v.nome === "telecomando rinominato.ir").versione, 1);
  assert.equal(c.voci().find((v) => v.nome === "tag cucina").versione, 2);
  assert.deepEqual(c.voci(null, " NUOVO ").map((v) => v.nome), ["tag cucina"]);
  assert.deepEqual(c.statistiche(), { numero: 5, byte: 300_000 + 1000 + 26 + 10, simulati: 2 });
  assert.deepEqual(await c.verifica(), []);
  assert.ok(c.haPin && (await c.sbloccaPin("2468")) && !(await c.sbloccaPin("1357")));
  c.chiudi();
  await c.sbloccaConRecupero(creata.recupero.toLowerCase().replaceAll("-", " "));

  // registro
  const log = await RegistroSicuro.apri(c);
  assert.deepEqual(await log.verifica(), []);
  assert.deepEqual(await log.leggi(), registroDiProva(4));

  // backup
  const dati = new Uint8Array(readFileSync(fileBackup));
  const voci = await leggiBackup(dati, "password-backup");
  assert.deepEqual(voci.map((v) => ({ category: v.categoria, name: v.nome, created: v.creato, modified: v.modificato, origin: v.origine, meta: v.meta, sha256: v.sha256, data: base64(v.dati) })),
    python("leggi_backup", { file: fileBackup, password: "password-backup" }).voci);
  await assert.rejects(leggiBackup(dati, "sbagliata!!"), { message: python("leggi_backup", { file: fileBackup, password: "sbagliata!!" }).messaggio });
  const altra = await Cassaforte.apri(new ArchivioMemoria(), { kdfN: VELOCE });
  await altra.crea("altra frase lunghissima");
  assert.deepEqual(await importaBackup(altra, dati, "password-backup"), { aggiunti: 5, saltati: 0 });
  assert.deepEqual(await importaBackup(altra, dati, "password-backup"), { aggiunti: 0, saltati: 5 });
  assert.deepEqual((await vociJs(altra)).map((v) => [v.name, v.origin, v.meta, v.data]).sort(), creata.voci.map((v) => [v.name, v.origin, v.meta, v.data]).sort());

  // JavaScript modifica la cassaforte di Python...
  const nuova = await c.aggiungi("rfid", "badge «ufficio»", testo("EM4100 1234"), { meta: { hex: "0011223344", prova: false } });
  await c.aggiorna(c.voci().find((v) => v.nome === "vuoto").id, { dati: testo("non più vuoto"), nome: "pieno" });
  await c.elimina(c.voci().find((v) => v.nome === "telecomando rinominato.ir").id);
  await c.cambiaFrase(FRASE, "nuova frase scelta sul telefono");
  const recupero = await c.nuovaChiaveRecupero();
  await c.impostaPin("97531");
  await log.aggiungi(registroDiProva(1, 4)[0]);
  await log.aggiungi({ ts: 1, category: "sicurezza", message: "dal telefono", level: "avviso", simulated: false });
  const attese = await vociJs(c);
  // ... e Python la riapre: stessi file, nella stessa forma che scriverebbe Python
  const dopo = python("apri", { cartella, n: VELOCE, frase: "nuova frase scelta sul telefono", cerca: "UFFICIO", pin_prove: ["2468", "97531"] });
  assert.deepEqual(dopo.voci, attese);
  assert.deepEqual(dopo.cerca, ["badge «ufficio»"]);
  assert.deepEqual(dopo.problemi, []);
  assert.ok(dopo.chiavi_canoniche && dopo.indice_canonico);
  assert.deepEqual(dopo.pin, [false, true]);
  assert.ok(dopo.voci.some((v) => v.id === nuova.id));
  assert.equal(python("apri", { cartella, n: VELOCE, frase: FRASE }).codice, "wrong");
  assert.equal(python("apri", { cartella, n: VELOCE, recupero: recupero.toLowerCase() }).id, creata.id);
  assert.equal(python("apri", { cartella, n: VELOCE, recupero: creata.recupero }).codice, "wrong"); // la vecchia non vale più
  const reg = python("registro", { cartella, n: VELOCE, frase: "nuova frase scelta sul telefono", forma: true });
  assert.deepEqual(reg.problemi, []);
  assert.deepEqual(reg.voci, await log.leggi());
  assert.equal(reg.voci.length, 6);
  assert.ok(reg.righe_canoniche && reg.voci_canoniche && reg.testa_canonica);
  // la catena continua anche nell'altro senso: Python aggiunge, JavaScript verifica
  python("registro", { cartella, n: VELOCE, frase: "nuova frase scelta sul telefono", aggiungi: registroDiProva(1, 99) });
  const log2 = await RegistroSicuro.apri(c);
  assert.deepEqual(await log2.verifica(), []);
  assert.equal((await log2.leggi()).at(-1).message, "voce 99 — è così 🐙");
});

test("registro e oggetti alterati: JavaScript e Python trovano gli stessi problemi (registro di Python)", salta, async (t) => {
  const { cartella, pulisci } = cartellaTemporanea();
  t.after(pulisci);
  python("crea", { cartella, n: VELOCE, frase: FRASE, voci: vociDiProva().slice(0, 4), registro: registroDiProva(5) });
  await confrontaManomissioni(t, cartella, VELOCE, FRASE);
  await confrontaOggetti(cartella, VELOCE, FRASE);
});

// ---------------- JavaScript → Python ----------------

test("cassaforte, registro e backup creati da JavaScript: Python li apre, li verifica e li importa", salta, async (t) => {
  const { cartella: base, pulisci } = cartellaTemporanea();
  t.after(pulisci);
  const cartella = path.join(base, "cassaforte");
  const c = await Cassaforte.apri(new ArchivioCartella(cartella), { kdfN: VELOCE });
  const recupero = await c.crea(FRASE);
  const ids = [];
  for (const v of vociDiProva()) ids.push((await c.aggiungi(v.category, v.name, daBase64(v.data), { origine: v.origin ?? "reale", meta: v.meta })).id);
  await c.aggiorna(ids[0], { dati: testo("versione 2"), meta: { uid: "04A1", nuovo: "sì" } });
  await c.aggiorna(ids[2], { nome: "telecomando rinominato.ir", segnaSimulato: true });
  await c.elimina(ids[5]);
  await c.impostaPin("2468");
  const log = await RegistroSicuro.apri(c);
  for (const e of registroDiProva(4)) await log.aggiungi(e);
  const attese = await vociJs(c);

  const py = python("apri", { cartella, n: VELOCE, frase: FRASE, cerca: "SÌ", pin_prove: ["0000", "1111", "2222", "3333", "2468"] });
  assert.equal(py.id, c.id);
  assert.deepEqual(py.voci, attese);
  assert.deepEqual(py.cerca, ["tag cucina"]);
  assert.deepEqual(py.problemi, []);
  assert.deepEqual(py.stats, { count: 5, bytes: 300_000 + 1000 + 26 + 10, simulated: 2 });
  assert.deepEqual(py.kdf, { alg: "scrypt", n: VELOCE, r: 8, p: 1 });
  assert.ok(py.has_pin && py.chiavi_canoniche && py.indice_canonico);
  assert.deepEqual(py.pin, [false, false, false, false, true]);
  // PIN: dopo 5 errori anche Python chiude la cassaforte creata da JavaScript
  const bloccata = python("apri", { cartella, n: VELOCE, recupero, pin_prove: ["0000", "0000", "0000", "0000", "0000", "2468"] });
  assert.deepEqual(bloccata.pin, [false, false, false, false, false, false]);
  assert.equal(bloccata.aperta_dopo_pin, false);

  const reg = python("registro", { cartella, n: VELOCE, frase: FRASE, forma: true });
  assert.deepEqual(reg.problemi, []);
  assert.deepEqual(reg.voci, registroDiProva(4));
  assert.ok(reg.righe_canoniche && reg.voci_canoniche && reg.testa_canonica);

  // backup
  const fileBackup = path.join(base, "dal-telefono.polpobak");
  const { dati, quanti } = await esportaBackup(c, "password-backup", { kdfN: VELOCE });
  assert.equal(quanti, 5);
  writeFileSync(fileBackup, dati);
  const letto = python("leggi_backup", { file: fileBackup, password: "password-backup" });
  assert.ok(letto.intestazione_canonica && letto.contenuto_canonico);
  assert.deepEqual(Object.keys(letto.intestazione), ["format", "version", "created", "kdf"]);
  assert.deepEqual(letto.voci.map((v) => [v.name, v.category, v.origin, v.meta, v.sha256, v.data]), attese.map((v) => [v.name, v.category, v.origin, v.meta, v.sha256, v.data]));
  const importato = python("importa", { cartella: path.join(base, "altra"), n: VELOCE, frase: "altra frase lunghissima", file: fileBackup, password: "password-backup" });
  assert.deepEqual(importato.primo, [5, 0]);
  assert.deepEqual(importato.secondo, [0, 5]);
  assert.deepEqual(importato.voci.map((v) => [v.name, v.origin, v.data]).sort(), attese.map((v) => [v.name, v.origin, v.data]).sort());
  assert.deepEqual(python("leggi_backup", { file: fileBackup, password: "sbagliata!!" }).messaggio, "password sbagliata oppure backup danneggiato");
  const rotto = dati.slice();
  rotto[rotto.length - 5] ^= 1;
  writeFileSync(fileBackup, rotto);
  const pyRotto = python("leggi_backup", { file: fileBackup, password: "password-backup" });
  await assert.rejects(leggiBackup(rotto, "password-backup"), { message: pyRotto.messaggio });

  // Python modifica la cassaforte di JavaScript, JavaScript la riapre
  python("apri", { cartella, n: VELOCE, frase: FRASE, cambia_frase: "frase cambiata sul computer", aggiungi: [{ category: "app", name: "dal computer", data: base64(testo("ciao")), meta: { app: "prova" } }] });
  const c2 = await Cassaforte.apri(new ArchivioCartella(cartella));
  await assert.rejects(c2.sblocca(FRASE), (e) => e.codice === "wrong");
  await c2.sblocca("frase cambiata sul computer");
  assert.deepEqual(c2.voci()[0].meta, { app: "prova" });
  assert.deepEqual(await c2.leggi(c2.voci()[0].id), testo("ciao"));
  assert.deepEqual(await c2.verifica(), []);
  c2.chiudi();
  await c2.sbloccaConRecupero(recupero);
});

test("registro e oggetti alterati: JavaScript e Python trovano gli stessi problemi (registro di JavaScript)", salta, async (t) => {
  const { cartella, pulisci } = cartellaTemporanea();
  t.after(pulisci);
  const c = await Cassaforte.apri(new ArchivioCartella(cartella), { kdfN: VELOCE });
  await c.crea(FRASE);
  for (const v of vociDiProva().slice(0, 4)) await c.aggiungi(v.category, v.name, daBase64(v.data), { meta: v.meta });
  const log = await RegistroSicuro.apri(c);
  for (const e of registroDiProva(5)) await log.aggiungi(e);
  await confrontaManomissioni(t, cartella, VELOCE, FRASE);
  await confrontaOggetti(cartella, VELOCE, FRASE);
});

// ---------------- con il costo vero di scrypt (N = 2^17) ----------------

test("N = 2^17 (il valore vero): Python → JavaScript", salta, async (t) => {
  const { cartella: base, pulisci } = cartellaTemporanea();
  t.after(pulisci);
  const cartella = path.join(base, "cassaforte");
  const fileBackup = path.join(base, "vero.polpobak");
  const creata = python("crea", { cartella, frase: FRASE, voci: vociDiProva().slice(0, 2), backup: { file: fileBackup, password: "password-backup" } });
  const c = await Cassaforte.apri(new ArchivioCartella(cartella));
  assert.equal(c.parametriKdf.n, 2 ** 17);
  const inizio = performance.now();
  await c.sblocca(FRASE);
  t.diagnostic(`sblocco con N = 2^17 in JavaScript: ${Math.round(performance.now() - inizio)} ms`);
  assert.deepEqual(await vociJs(c), creata.voci);
  const voci = await leggiBackup(new Uint8Array(readFileSync(fileBackup)), "password-backup");
  assert.deepEqual(voci.map((v) => base64(v.dati)).sort(), creata.voci.map((v) => v.data).sort());
});

test("N = 2^17 (il valore vero): JavaScript → Python", salta, async (t) => {
  const { cartella: base, pulisci } = cartellaTemporanea();
  t.after(pulisci);
  const cartella = path.join(base, "cassaforte");
  const c = await Cassaforte.apri(new ArchivioCartella(cartella));
  const inizio = performance.now();
  const recupero = await c.crea(FRASE);
  t.diagnostic(`creazione con N = 2^17 in JavaScript (due derivazioni): ${Math.round(performance.now() - inizio)} ms`);
  await c.aggiungi("nfc", "vero", testo("dati veri"));
  const { dati } = await esportaBackup(c, "password-backup");
  const fileBackup = path.join(base, "vero.polpobak");
  writeFileSync(fileBackup, dati);
  const py = python("apri", { cartella, recupero });
  assert.equal(py.kdf.n, 2 ** 17);
  assert.deepEqual(py.voci, await vociJs(c));
  const letto = python("leggi_backup", { file: fileBackup, password: "password-backup" });
  assert.equal(letto.intestazione.kdf.n, 2 ** 17);
  assert.deepEqual(letto.voci.map((v) => senzaDati(v).name), ["vero"]);
});
