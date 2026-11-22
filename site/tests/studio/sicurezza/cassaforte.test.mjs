// La cassaforte (cassaforte.js): le stesse prove di studio/tests/test_security.py, più quelle per JavaScript.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Cassaforte, ErroreCassaforte, ErroreIntegrita, MAX_ERRORI_PIN, CATEGORIE } from "../../../assets/js/studio/sicurezza/cassaforte.js";
import { ArchivioMemoria } from "../../../assets/js/studio/sicurezza/archivio.js";
import { ArchivioCartella, cartellaTemporanea, testo } from "./aiuto.mjs";

const VELOCE = 2 ** 10;
const FRASE = "una frase abbastanza lunga";

async function nuova(archivio = new ArchivioMemoria()) {
  const c = await Cassaforte.apri(archivio, { kdfN: VELOCE });
  c.recupero = await c.crea(FRASE);
  return c;
}

const codice = (c) => (e) => e instanceof ErroreCassaforte && e.codice === c;

test("crea e apre con la frase e con la chiave di recupero", async () => {
  const c = await nuova();
  const voce = await c.aggiungi("nfc", "tag cucina", Uint8Array.from([1, 2]), { meta: { uid: "04A1" } });
  c.chiudi();
  assert.ok(!c.aperta);
  const c2 = await Cassaforte.apri(c.archivio, { kdfN: VELOCE });
  assert.ok(c2.esiste && !c2.aperta && c2.id === c.id);
  await assert.rejects(c2.sblocca("frase sbagliata!!"), (e) => codice("wrong")(e) && e.message === "frase di accesso sbagliata");
  await c2.sbloccaConRecupero(c.recupero.toLowerCase());
  assert.deepEqual(await c2.leggi(voce.id), Uint8Array.from([1, 2]));
  assert.equal(c2.voci(null, "04a1")[0].nome, "tag cucina");
  c2.chiudi();
  await c2.sblocca(FRASE);
  assert.deepEqual(c2.voce(voce.id).meta, { uid: "04A1" });
  await assert.rejects(c2.sbloccaConRecupero("ABCD"), (e) => codice("bad_key")(e) && /32 caratteri/.test(e.message));
  await assert.rejects(c2.sbloccaConRecupero("A".repeat(32)), (e) => codice("wrong")(e) && e.message === "chiave di recupero sbagliata");
});

test("cassaforte che non esiste o esiste già", async () => {
  const c = await Cassaforte.apri(new ArchivioMemoria(), { kdfN: VELOCE });
  assert.ok(!c.esiste);
  await assert.rejects(c.sblocca(FRASE), codice("missing"));
  assert.throws(() => c.voci(), codice("locked"));
  await c.crea(FRASE);
  await assert.rejects(c.crea(FRASE), (e) => codice("exists")(e) && e.message === "la cassaforte esiste già");
  const altra = await Cassaforte.apri(c.archivio, { kdfN: VELOCE });
  await assert.rejects(altra.crea("un'altra frase lunga"), codice("exists"));
});

test("niente è leggibile nei file", async () => {
  const c = await nuova();
  await c.aggiungi("radio", "presa del salotto", testo("SEGRETO-IN-CHIARO"));
  for (const [nome, dati] of c.archivio.file) {
    const t = Buffer.from(dati).toString("latin1");
    assert.ok(!t.includes("SEGRETO-IN-CHIARO") && !t.includes("salotto"), nome);
  }
});

test("file alterati, scambiati o riportati a una versione vecchia", async () => {
  const c = await nuova();
  const file = c.archivio.file;
  const a = await c.aggiungi("ir", "a", testo("aaaa"));
  const b = await c.aggiungi("ir", "b", testo("bbbb"));
  assert.deepEqual(await c.verifica(), []);
  const vecchio = file.get("oggetti/" + a.id);
  await c.aggiorna(a.id, { dati: testo("aaaa-v2") });
  file.set("oggetti/" + a.id, vecchio); // ritorno a una versione vecchia
  assert.deepEqual((await c.verifica()).map((p) => p.cosa), ["alterato o danneggiato"]);
  file.set("oggetti/" + a.id, file.get("oggetti/" + b.id)); // scambio
  await assert.rejects(c.leggi(a.id), ErroreIntegrita);
  const blob = file.get("oggetti/" + b.id).slice();
  blob[blob.length - 1] ^= 1;
  file.set("oggetti/" + b.id, blob);
  file.set("oggetti/estraneo", testo("x"));
  file.set("oggetti/in-corso.tmp", testo("x")); // un file temporaneo non è estraneo (come in Python)
  const problemi = await c.verifica();
  assert.equal(problemi.length, 3);
  assert.deepEqual(problemi.at(-1), { idVoce: "estraneo", cosa: "file estraneo nella cartella" });
  file.delete("oggetti/" + b.id);
  assert.ok((await c.verifica()).some((p) => p.idVoce === b.id && p.cosa === "mancante"));
  await assert.rejects(c.leggi(b.id), ErroreIntegrita);
});

test("indice alterato: la cassaforte non si apre", async () => {
  const c = await nuova();
  await c.aggiungi("nfc", "x", testo("1"));
  c.chiudi();
  const blob = c.archivio.file.get("indice.bin").slice();
  blob[20] ^= 0xff;
  c.archivio.file.set("indice.bin", blob);
  await assert.rejects(c.sblocca(FRASE), (e) => codice("corrupt")(e) && e.message === "indice della cassaforte alterato o danneggiato");
  assert.ok(!c.aperta);
});

test("cambio della frase e nuova chiave di recupero", async () => {
  const c = await nuova();
  await assert.rejects(c.cambiaFrase("sbagliata", "nuova frase molto lunga"), (e) => codice("wrong")(e) && e.message === "frase di accesso attuale sbagliata");
  await c.cambiaFrase(FRASE, "nuova frase molto lunga");
  const nuovaChiave = await c.nuovaChiaveRecupero();
  c.chiudi();
  await assert.rejects(c.sblocca(FRASE), codice("wrong"));
  await assert.rejects(c.sbloccaConRecupero(c.recupero), codice("wrong")); // la vecchia chiave non vale più
  await c.sbloccaConRecupero(nuovaChiave);
  c.chiudi();
  await c.sblocca("nuova frase molto lunga");
  assert.ok(await c.verificaFrase("nuova frase molto lunga"));
  assert.ok(!(await c.verificaFrase(FRASE)));
  c.chiudi();
  await assert.rejects(c.nuovaChiaveRecupero(), codice("locked"));
  await assert.rejects(c.cambiaFrase("nuova frase molto lunga", "ancora un'altra frase"), codice("locked"));
});

test("PIN: blocco rapido e chiusura dopo 5 errori", async () => {
  const c = await nuova();
  await assert.rejects(c.impostaPin("12a4"), (e) => codice("bad_pin")(e) && e.message === "il PIN ha da 4 a 12 cifre");
  await assert.rejects(c.impostaPin("123"), codice("bad_pin"));
  await assert.rejects(c.impostaPin("1234567890123"), codice("bad_pin"));
  await c.impostaPin("2468");
  assert.ok(c.haPin);
  assert.ok(!new TextDecoder().decode(c.archivio.file.get("chiavi.json")).includes("2468"));
  c.bloccaSchermo();
  assert.ok(c.bloccoRapido);
  assert.ok((await c.sbloccaPin("2468")) && !c.bloccoRapido);
  c.bloccaSchermo();
  for (let i = 0; i < MAX_ERRORI_PIN - 1; i++) assert.ok(!(await c.sbloccaPin("0000")));
  assert.equal(c.erroriPin, MAX_ERRORI_PIN - 1);
  assert.ok(c.aperta);
  assert.ok(!(await c.sbloccaPin("0000")));
  assert.ok(!c.aperta); // dopo 5 errori serve la frase
  assert.ok(!(await c.sbloccaPin("2468"))); // a cassaforte chiusa il PIN non apre nulla
  await c.sblocca(FRASE);
  assert.equal(c.erroriPin, 0);
  // la frase sblocca lo schermo e azzera gli errori
  c.bloccaSchermo();
  await c.sbloccaPin("1111");
  assert.ok(await c.riprendiConFrase(FRASE));
  assert.ok(!c.bloccoRapido && c.erroriPin === 0);
  await c.togliPin();
  assert.ok(!c.haPin);
  assert.ok(!(await c.sbloccaPin("2468")));
  c.chiudi();
  await assert.rejects(c.impostaPin("2468"), codice("locked"));
});

test("portachiavi: aggancio facoltativo per «Ricorda su questo dispositivo»", async () => {
  const senza = await nuova();
  await assert.rejects(senza.ricordaSuQuestoDispositivo(true), (e) => codice("keyring")(e) && e.message.startsWith("portachiavi del sistema non disponibile"));
  await senza.ricordaSuQuestoDispositivo(false); // nessun errore
  assert.ok(!(await senza.provaPortachiavi()));

  const rotto = { salva: async () => { throw new Error("nessun portachiavi"); }, leggi: async () => null, cancella: async () => {} };
  const c1 = await Cassaforte.apri(new ArchivioMemoria(), { kdfN: VELOCE, portachiavi: rotto });
  await c1.crea(FRASE);
  await assert.rejects(c1.ricordaSuQuestoDispositivo(true), (e) => codice("keyring")(e) && e.message === "portachiavi del sistema non disponibile: nessun portachiavi");

  const deposito = new Map();
  const pk = {
    salva: async (s, u, p) => void deposito.set(`${s}|${u}`, p),
    leggi: async (s, u) => deposito.get(`${s}|${u}`) ?? null,
    cancella: async (s, u) => void deposito.delete(`${s}|${u}`),
  };
  const c = await Cassaforte.apri(new ArchivioMemoria(), { kdfN: VELOCE, portachiavi: pk });
  await c.crea(FRASE);
  await c.aggiungi("app", "x", testo("1"));
  await c.ricordaSuQuestoDispositivo(true);
  assert.deepEqual([...deposito.keys()], [`Polpo Studio|${c.id}`]);
  c.chiudi();
  await assert.rejects(c.ricordaSuQuestoDispositivo(true), codice("locked"));
  assert.ok(await c.provaPortachiavi());
  assert.equal(c.voci().length, 1);
  deposito.set(`Polpo Studio|${c.id}`, Buffer.alloc(32).toString("base64")); // chiave sbagliata
  c.chiudi();
  assert.ok(!(await c.provaPortachiavi()) && !c.aperta);
  deposito.set(`Polpo Studio|${c.id}`, "non base64!");
  assert.ok(!(await c.provaPortachiavi()));
  await c.ricordaSuQuestoDispositivo(false);
  assert.equal(deposito.size, 0);
});

test("origine simulata, categorie e statistiche", async () => {
  const c = await nuova();
  const v = await c.aggiungi("radio", "dal virtuale", testo("1"), { origine: "simulato" });
  assert.ok(v.simulato && v.origine === "simulato");
  assert.deepEqual(c.statistiche(), { numero: 1, byte: 1, simulati: 1 });
  await assert.rejects(c.aggiungi("radio", "x", testo("1"), { origine: "boh" }), (e) => codice("bad_origin")(e) && e.message === "origine sconosciuta");
  await assert.rejects(c.aggiungi("armi", "x", testo("1")), (e) => codice("bad_category")(e) && e.message === "categoria sconosciuta: armi");
  await assert.rejects(c.aggiungi(undefined, "x", testo("1")), { message: "categoria sconosciuta: None" });
  await assert.rejects(c.aggiungi("radio", "x", "non sono byte"), TypeError);
  assert.equal(CATEGORIE.length, 10);
  // un file reale diventa simulato, e non torna indietro
  const r = await c.aggiungi("ir", "telecomando", testo("tasto"));
  const s = await c.aggiorna(r.id, { segnaSimulato: true });
  assert.ok(s.simulato);
  assert.ok((await c.aggiorna(r.id, { nome: "telecomando 2" })).simulato);
  assert.deepEqual(c.statistiche(), { numero: 2, byte: 6, simulati: 2 });
});

test("elenco, ricerca, aggiornamento ed eliminazione", async () => {
  const c = await nuova();
  const a = await c.aggiungi("nfc", "Tag Cucina", testo("aaa"), { meta: { nota: "è mio", n: 3 } });
  await new Promise((ok) => setTimeout(ok, 5));
  const b = await c.aggiungi("radio", "presa", testo("bb"));
  assert.deepEqual(c.voci().map((v) => v.nome), ["presa", "Tag Cucina"]); // dalla più recente
  assert.deepEqual(c.voci("nfc").map((v) => v.id), [a.id]);
  assert.deepEqual(c.voci(null, "  cucina ").map((v) => v.id), [a.id]);
  assert.deepEqual(c.voci(null, "È MIO").map((v) => v.id), [a.id]); // anche nei metadati
  assert.deepEqual(c.voci(null, '"n": 3').map((v) => v.id), [a.id]); // i metadati come li scrive Python
  assert.deepEqual(c.voci("radio", "cucina"), []);
  // le voci restituite sono copie
  const copia = c.voce(a.id);
  assert.throws(() => { copia.nome = "altro"; }, TypeError);
  copia.meta.nota = "cambiata";
  assert.equal(c.voce(a.id).meta.nota, "è mio");

  await new Promise((ok) => setTimeout(ok, 5));
  const a2 = await c.aggiorna(a.id, { dati: testo("aaaa-v2"), meta: { nota: "nuova" } });
  assert.equal(a2.versione, 2);
  assert.equal(a2.dimensione, 7);
  assert.ok(a2.modificato > a.modificato && a2.creato === a.creato);
  assert.deepEqual(await c.leggi(a.id), testo("aaaa-v2"));
  assert.equal(c.voci()[0].id, a.id);
  const vuoto = await c.aggiorna(b.id, { dati: new Uint8Array(0) });
  assert.equal(vuoto.dimensione, 0);
  assert.deepEqual(await c.leggi(b.id), new Uint8Array(0));
  await c.elimina(b.id);
  assert.throws(() => c.voce(b.id), (e) => codice("not_found")(e) && e.message === "file non trovato nella cassaforte");
  await assert.rejects(c.elimina(b.id), codice("not_found"));
  assert.ok(!c.archivio.file.has("oggetti/" + b.id));
  assert.deepEqual(await c.verifica(), []);
  // tutto resta dopo la riapertura
  c.chiudi();
  await c.sblocca(FRASE);
  assert.deepEqual(c.voci().map((v) => [v.nome, v.versione, v.meta]), [["Tag Cucina", 2, { nota: "nuova" }]]);
});

/** Archivio che si ferma prima di scrivere un oggetto, finché la prova non lo lascia andare. */
class ArchivioLento extends ArchivioMemoria {
  async scrivi(nome, dati) {
    if (this.fermati && nome.startsWith("oggetti/")) {
      const vai = new Promise((ok) => (this.vai = ok));
      this.fermati();
      await vai;
    }
    return super.scrivi(nome, dati);
  }
}

test("operazioni contemporanee: una alla volta, nell'ordine", async () => {
  const archivio = new ArchivioLento();
  const c = await nuova(archivio);
  const voci = await Promise.all(Array.from({ length: 20 }, (_, i) => c.aggiungi("altro", `f${i}`, testo(`dati ${i}`))));
  assert.equal(new Set(voci.map((v) => v.id)).size, 20);
  c.chiudi();
  await c.sblocca(FRASE);
  assert.equal(c.voci().length, 20);
  assert.deepEqual(await c.verifica(), []);
  // chiudere mentre si scrive: l'operazione già partita finisce con le sue chiavi e l'indice resta coerente
  const ferma = new Promise((ok) => (archivio.fermati = ok));
  const inCorso = c.aggiungi("altro", "ultimo", testo("x"));
  await ferma;
  archivio.fermati = null;
  c.chiudi();
  archivio.vai();
  await inCorso;
  assert.ok(!c.aperta);
  await c.sblocca(FRASE);
  assert.equal(c.voci().length, 21);
  assert.deepEqual(await c.verifica(), []);
  // quelle ancora in coda quando si chiude trovano la cassaforte chiusa
  const dopo = c.aggiungi("altro", "tardi", testo("y"));
  c.chiudi();
  await assert.rejects(dopo, codice("locked"));
});

test("avanzamento di scrypt durante creazione e apertura", async () => {
  const c = await Cassaforte.apri(new ArchivioMemoria(), { kdfN: VELOCE });
  const visti = [];
  await c.crea(FRASE, { progresso: (f) => visti.push(f) });
  assert.ok(visti.some((f) => f > 0.4 && f < 0.6) && visti.at(-1) === 1);
  c.chiudi();
  let ultimo = 0;
  await c.sblocca(FRASE, { progresso: (f) => (ultimo = f) });
  assert.equal(ultimo, 1);
  assert.deepEqual(c.parametriKdf, { alg: "scrypt", n: VELOCE, r: 8, p: 1 });
});

test("su una cartella vera: gli stessi file di Polpo Studio", async (t) => {
  const { cartella, pulisci } = cartellaTemporanea();
  t.after(pulisci);
  const c = await nuova(new ArchivioCartella(cartella));
  const v = await c.aggiungi("ibutton", "chiave", testo("01020304"));
  assert.deepEqual((await c.archivio.elenco()).filter((n) => !n.endsWith(".tmp")), ["chiavi.json", "indice.bin", "oggetti/" + v.id]);
  const chiavi = JSON.parse(new TextDecoder().decode(await c.archivio.leggi("chiavi.json")));
  assert.deepEqual(Object.keys(chiavi), ["format", "version", "id", "created", "kdf", "slots", "pin"]);
  assert.equal(chiavi.format, "polpo-vault");
  assert.match(chiavi.id, /^[0-9a-f]{32}$/);
  const c2 = await Cassaforte.apri(new ArchivioCartella(cartella));
  await c2.sblocca(FRASE);
  assert.deepEqual(await c2.leggi(v.id), testo("01020304"));
});
