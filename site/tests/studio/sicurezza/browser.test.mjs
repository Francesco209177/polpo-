// La sicurezza in Chromium (come nella WebView di Android): WebCrypto, CompressionStream, IndexedDB e scrypt.
// Le pagine si aprono da file:// (contesto sicuro), senza server. Serve Playwright con Chromium; senza, si salta.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Cassaforte } from "../../../assets/js/studio/sicurezza/cassaforte.js";
import { ArchivioMemoria } from "../../../assets/js/studio/sicurezza/archivio.js";
import { esportaBackup, leggiBackup } from "../../../assets/js/studio/sicurezza/backup.js";
import { RegistroSicuro } from "../../../assets/js/studio/sicurezza/registro_sicuro.js";
import { SENZA_PYTHON, base64, cartellaTemporanea, daBase64, python, testo } from "./aiuto.mjs";

const qui = path.dirname(fileURLToPath(import.meta.url));
const SICUREZZA = pathToFileURL(path.resolve(qui, "../../../assets/js/studio/sicurezza/")).href + "/";

let browser = null;
let motivo = false;
try {
  const { chromium } = createRequire(import.meta.url)("playwright");
  browser = await chromium.launch({ args: ["--allow-file-access-from-files"] });
} catch (e) {
  motivo = `Chromium con Playwright non disponibile: ${String(e.message).split("\n")[0]}`;
}
after(() => browser?.close());

async function pagina() {
  const p = await browser.newPage();
  const errori = [];
  p.on("pageerror", (e) => errori.push(e.message));
  p.on("request", (r) => { if (!r.url().startsWith("file:")) errori.push("richiesta esterna: " + r.url()); });
  await p.goto(pathToFileURL(path.join(qui, "index.js")).href); // un file di testo qualsiasi: basta l'origine file://
  return { p, errori };
}

test("Chromium: tempo di scrypt con N = 2^17 (WebCrypto e pagina sicura)", { skip: motivo }, async (t) => {
  const { p, errori } = await pagina();
  const r = await p.evaluate(async (base) => {
    const C = await import(base + "cripto.js");
    const tempi = [];
    let chiamate = 0;
    for (let i = 0; i < 3; i++) {
      const inizio = performance.now();
      await C.deriva(new TextEncoder().encode("una frase abbastanza lunga"), new Uint8Array(16), C.KDF_N, C.KDF_R, C.KDF_P, { progresso: () => chiamate++ });
      tempi.push(performance.now() - inizio);
    }
    return { sicuro: isSecureContext, tempi, chiamate, agente: navigator.userAgent };
  }, SICUREZZA);
  assert.ok(r.sicuro);
  assert.ok(r.chiamate > 100); // l'avanzamento arriva mentre si calcola
  t.diagnostic(`scrypt N = 2^17 in Chromium: ${r.tempi.map((x) => Math.round(x)).join(", ")} ms (${r.agente.match(/Chrome\/[\d.]+/)?.[0]})`);
  assert.deepEqual(errori, []);
  await p.close();
});

test("Chromium: cassaforte su IndexedDB, registro e backup; i file si aprono anche su Node (e in Python)", { skip: motivo }, async (t) => {
  // un backup fatto su Node, da ripristinare nel browser
  const sorgente = await Cassaforte.apri(new ArchivioMemoria(), { kdfN: 2 ** 10 });
  await sorgente.crea("frase della cassaforte su Node");
  await sorgente.aggiungi("radio", "dal computer.sub", testo("Filetype: Flipper SubGhz"), { origine: "simulato", meta: { raw: true } });
  const { dati: backupNode } = await esportaBackup(sorgente, "password-backup", { kdfN: 2 ** 10 });

  const { p, errori } = await pagina();
  const nome = "prova-" + Math.random().toString(16).slice(2);
  const r = await p.evaluate(async ({ base, nome, backupB64 }) => {
    const { Cassaforte } = await import(base + "cassaforte.js");
    const { ArchivioIndexedDB } = await import(base + "archivio.js");
    const { RegistroSicuro } = await import(base + "registro_sicuro.js");
    const { esportaBackup, importaBackup } = await import(base + "backup.js");
    const { inBase64, daBase64 } = await import(base + "formati.js");
    const enc = (s) => new TextEncoder().encode(s);
    let a = await ArchivioIndexedDB.apri(nome);
    const nomiDb = (await indexedDB.databases()).map((d) => d.name);
    let c = await Cassaforte.apri(a, { kdfN: 2 ** 10 });
    const recupero = await c.crea("frase scelta sul telefono");
    const v = await c.aggiungi("nfc", "tag «cucina»", enc("dati del tag"), { meta: { uid: "04A1", nota: "è mio" } });
    await c.aggiungi("ir", "grande.ir", new Uint8Array(200_000).map((_, i) => i * 7));
    await c.impostaPin("2468");
    let log = await RegistroSicuro.apri(c);
    for (let i = 0; i < 3; i++) await log.aggiungi({ ts: i, category: "test", message: `voce ${i}`, level: "info", simulated: false });
    const importato = await importaBackup(c, daBase64(backupB64), "password-backup");
    const { dati: backup } = await esportaBackup(c, "password-backup", { kdfN: 2 ** 10 });
    // chiusura e riapertura del database
    c.chiudi();
    a.chiudi();
    a = await ArchivioIndexedDB.apri(nome);
    c = await Cassaforte.apri(a);
    await c.sblocca("frase scelta sul telefono");
    log = await RegistroSicuro.apri(c);
    const risultato = {
      nomiDb,
      recupero,
      importato,
      letto: new TextDecoder().decode(await c.leggi(v.id)),
      voci: c.voci().map((x) => [x.nome, x.categoria, x.origine]),
      problemi: await c.verifica(),
      registro: await log.verifica(),
      messaggi: (await log.leggi()).map((e) => e.message),
      pin: await c.sbloccaPin("2468"),
      backup: inBase64(backup),
      file: {},
    };
    for (const n of await a.elenco()) risultato.file[n] = inBase64(await a.leggi(n));
    risultato.oggetti = (await a.elenco("oggetti/")).length;
    await a.cancella("non-esiste");
    a.chiudi();
    await ArchivioIndexedDB.elimina(nome);
    return risultato;
  }, { base: SICUREZZA, nome, backupB64: base64(backupNode) });

  assert.ok(r.nomiDb.includes("polpo-" + nome));
  assert.deepEqual(r.importato, { aggiunti: 1, saltati: 0 });
  assert.equal(r.letto, "dati del tag");
  assert.deepEqual(r.voci.map((x) => x[0]).sort(), ["dal computer.sub", "grande.ir", "tag «cucina»"]);
  assert.deepEqual(r.voci.find((x) => x[0] === "dal computer.sub"), ["dal computer.sub", "radio", "simulato"]);
  assert.deepEqual(r.problemi, []);
  assert.deepEqual(r.registro, []);
  assert.deepEqual(r.messaggi, ["voce 0", "voce 1", "voce 2"]);
  assert.ok(r.pin);
  assert.equal(r.oggetti, 3);
  const nomi = Object.keys(r.file);
  assert.deepEqual(nomi.filter((n) => !n.startsWith("oggetti/")), ["chiavi.json", "indice.bin", "registro.log", "registro.testa"]);
  assert.equal(nomi.filter((n) => n.startsWith("oggetti/")).length, 3);
  assert.deepEqual(errori, []);
  await p.close();

  // i file scritti dal browser si aprono su Node...
  const copia = new ArchivioMemoria(Object.fromEntries(Object.entries(r.file).map(([n, d]) => [n, daBase64(d)])));
  const c = await Cassaforte.apri(copia);
  await c.sbloccaConRecupero(r.recupero);
  assert.deepEqual(await c.verifica(), []);
  assert.deepEqual(await (await RegistroSicuro.apri(c)).verifica(), []);
  assert.equal((await leggiBackup(daBase64(r.backup), "password-backup")).length, 3);

  // ... e in Python (se c'è)
  if (SENZA_PYTHON) return t.diagnostic(SENZA_PYTHON);
  const { cartella, pulisci } = cartellaTemporanea();
  t.after(pulisci);
  for (const [n, d] of Object.entries(r.file)) {
    mkdirSync(path.dirname(path.join(cartella, n)), { recursive: true });
    writeFileSync(path.join(cartella, n), daBase64(d));
  }
  const py = python("apri", { cartella, n: 2 ** 10, frase: "frase scelta sul telefono" });
  assert.deepEqual(py.problemi, []);
  assert.ok(py.chiavi_canoniche && py.indice_canonico && py.has_pin);
  assert.deepEqual(py.voci.map((v) => v.name).sort(), ["dal computer.sub", "grande.ir", "tag «cucina»"]);
  assert.deepEqual(python("registro", { cartella, n: 2 ** 10, frase: "frase scelta sul telefono" }).problemi, []);
  writeFileSync(path.join(cartella, "dal-browser.polpobak"), daBase64(r.backup));
  assert.equal(python("leggi_backup", { file: path.join(cartella, "dal-browser.polpobak"), password: "password-backup" }).voci.length, 3);
});
