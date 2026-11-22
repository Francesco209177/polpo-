// Registro attività con catena HMAC (registro_sicuro.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Cassaforte } from "../../../assets/js/studio/sicurezza/cassaforte.js";
import { ArchivioMemoria } from "../../../assets/js/studio/sicurezza/archivio.js";
import { RegistroSicuro } from "../../../assets/js/studio/sicurezza/registro_sicuro.js";
import { testo } from "./aiuto.mjs";

async function nuova(archivio = new ArchivioMemoria()) {
  const c = await Cassaforte.apri(archivio, { kdfN: 2 ** 10 });
  await c.crea("una frase abbastanza lunga");
  return c;
}

const voce = (messaggio) => ({ ts: Date.now() / 1000, category: "test", message: messaggio, level: "info", simulated: false });
const leggiRighe = (c) => new TextDecoder().decode(c.archivio.file.get("registro.log")).split("\n").filter(Boolean);
const scriviRighe = (c, righe) => c.archivio.file.set("registro.log", testo(righe.join("\n") + "\n"));

test("la catena scopre righe cambiate, tolte e tagliate", async () => {
  const c = await nuova();
  const log = await RegistroSicuro.apri(c);
  for (let i = 0; i < 5; i++) await log.aggiungi(voce(`voce ${i}`));
  assert.deepEqual(await log.verifica(), []);
  assert.deepEqual((await log.leggi()).map((e) => e.message), [0, 1, 2, 3, 4].map((i) => `voce ${i}`));
  assert.deepEqual((await log.leggi(2)).map((e) => e.message), ["voce 3", "voce 4"]);
  assert.ok(!Buffer.from(c.archivio.file.get("registro.log")).includes("voce"));
  const righe = leggiRighe(c);
  // riga tolta in mezzo
  scriviRighe(c, [...righe.slice(0, 2), ...righe.slice(3)]);
  assert.deepEqual(await log.verifica(), [
    "riga 3: numero 4 invece di 3 (righe tolte o spostate)",
    "riga 3: non segue la riga precedente",
  ]);
  // ultime righe tagliate
  scriviRighe(c, righe.slice(0, 3));
  assert.deepEqual(await log.verifica(), ["le ultime righe del registro sono state tolte o sostituite"]);
  // contenuto cambiato
  const d = JSON.parse(righe[1]);
  d.c = d.c.slice(0, -4) + "AAAA";
  scriviRighe(c, [righe[0], JSON.stringify(d), ...righe.slice(2)]);
  assert.deepEqual(await log.verifica(), ["riga 2: HMAC non valido (riga modificata)", "riga 2: contenuto alterato"]);
  assert.equal((await log.leggi()).length, 4); // la riga illeggibile viene saltata
  // righe scambiate
  scriviRighe(c, [righe[1], righe[0], ...righe.slice(2)]);
  assert.ok((await log.verifica()).includes("riga 1: numero 2 invece di 1 (righe tolte o spostate)"));
  // riga illeggibile
  scriviRighe(c, [righe[0], "non è json", ...righe.slice(1)]);
  assert.deepEqual(await log.verifica(), ["riga 2: formato non valido", "riga 3: non segue la riga precedente"]);
  // tutto rimesso a posto (anche con i ritorni a capo di Windows)
  c.archivio.file.set("registro.log", testo(righe.join("\r\n") + "\r\n"));
  assert.deepEqual(await log.verifica(), []);
  // riapertura: la catena continua
  const log2 = await RegistroSicuro.apri(c);
  await log2.aggiungi({ ts: 1, category: "t", message: "dopo", level: "info", simulated: false });
  assert.deepEqual(await log2.verifica(), []);
  assert.equal((await log2.leggi()).at(-1).message, "dopo");
});

test("registro svuotato, testa mancante o alterata", async () => {
  const c = await nuova();
  const log = await RegistroSicuro.apri(c);
  assert.deepEqual(await log.verifica(), []);
  assert.deepEqual(await log.leggi(), []);
  await log.aggiungi(voce("uno"));
  const testa = c.archivio.file.get("registro.testa");
  c.archivio.file.delete("registro.log");
  assert.deepEqual(await log.verifica(), ["il registro è stato svuotato"]);
  scriviRighe(c, []);
  assert.deepEqual(await log.verifica(), ["il registro è stato svuotato"]);
  await log.aggiungi(voce("due")); // la catena riparte da dove era (come in Python)
  c.archivio.file.delete("registro.testa");
  assert.ok((await log.verifica()).includes("manca il file di controllo del registro"));
  const rotta = testa.slice();
  rotta[15] ^= 1;
  c.archivio.file.set("registro.testa", rotta);
  assert.ok((await log.verifica()).includes("file di controllo del registro alterato"));
});

test("chiavi legate alla cassaforte", async () => {
  const c = await nuova();
  const log = await RegistroSicuro.apri(c);
  await log.aggiungi(voce("segreto"));
  // un'altra cassaforte non legge né convalida il registro
  const altra = await nuova();
  for (const nome of ["registro.log", "registro.testa"]) altra.archivio.file.set(nome, c.archivio.file.get(nome));
  const estraneo = await RegistroSicuro.apri(altra);
  assert.deepEqual(await estraneo.leggi(), []);
  assert.ok((await estraneo.verifica()).includes("riga 1: HMAC non valido (riga modificata)"));
  c.chiudi();
  await assert.rejects(RegistroSicuro.apri(c), (e) => e.codice === "locked");
  log.chiudi();
  await assert.rejects(log.aggiungi(voce("x")), /registro chiuso/);
});

test("ultima riga illeggibile all'apertura", async () => {
  const c = await nuova();
  const log = await RegistroSicuro.apri(c);
  await log.aggiungi(voce("uno"));
  scriviRighe(c, [...leggiRighe(c), "{rotta"]);
  await assert.rejects(RegistroSicuro.apri(c), { name: "ErroreIntegrita" });
});
