// Copie di sicurezza .polpobak (backup.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Cassaforte } from "../../../assets/js/studio/sicurezza/cassaforte.js";
import { ArchivioMemoria } from "../../../assets/js/studio/sicurezza/archivio.js";
import { ErroreBackup, MAGIC, esportaBackup, importaBackup, leggiBackup, leggiIntestazione } from "../../../assets/js/studio/sicurezza/backup.js";
import { u32be, unisci, utf8 } from "../../../assets/js/studio/sicurezza/formati.js";
import { testo } from "./aiuto.mjs";

const VELOCE = 2 ** 10;

async function nuova(frase = "una frase abbastanza lunga") {
  const c = await Cassaforte.apri(new ArchivioMemoria(), { kdfN: VELOCE });
  await c.crea(frase);
  return c;
}

test("backup e ripristino in un'altra cassaforte", async () => {
  const c = await nuova();
  await c.aggiungi("nfc", "uno", testo("1".repeat(1000)), { meta: { note: "è mio" } });
  await c.aggiungi("radio", "due", testo("2"), { origine: "simulato" });
  const { dati, quanti } = await esportaBackup(c, "password-backup", { kdfN: VELOCE });
  assert.equal(quanti, 2);
  assert.deepEqual(dati.subarray(0, 9), MAGIC);
  assert.ok(!Buffer.from(dati).includes("uno"));
  await assert.rejects(leggiBackup(dati, "sbagliata!"), (e) => e instanceof ErroreBackup && e.message === "password sbagliata oppure backup danneggiato");
  const info = leggiIntestazione(dati);
  assert.deepEqual(info.kdf, { alg: "scrypt", n: VELOCE, r: 8, p: 1 });
  assert.ok(Math.abs(info.creato - Date.now() / 1000) < 60);

  const altra = await nuova("altra frase lunghissima");
  assert.deepEqual(await importaBackup(altra, dati, "password-backup"), { aggiunti: 2, saltati: 0 });
  assert.deepEqual(await importaBackup(altra, dati, "password-backup"), { aggiunti: 0, saltati: 2 });
  const nomi = Object.fromEntries(altra.voci().map((v) => [v.nome, v]));
  assert.ok(nomi.due.simulato);
  assert.deepEqual(nomi.uno.meta, { note: "è mio" });
  assert.deepEqual(await altra.leggi(nomi.uno.id), testo("1".repeat(1000)));

  const rotto = dati.slice();
  rotto[rotto.length - 5] ^= 1;
  await assert.rejects(leggiBackup(rotto, "password-backup"), ErroreBackup);
  await assert.rejects(esportaBackup(c, "corta", { kdfN: VELOCE }), (e) => e instanceof ErroreBackup && e.message === "la password del backup deve avere almeno 8 caratteri");
  await assert.rejects(esportaBackup(c, "🐙🐙🐙🐙🐙🐙🐙", { kdfN: VELOCE }), ErroreBackup); // 7 caratteri (14 unità UTF-16)
});

test("file che non sono backup o con l'intestazione sbagliata", async () => {
  await assert.rejects(leggiBackup(testo("ciao"), "password-backup"), { message: "non è un backup di Polpo Studio" });
  await assert.rejects(leggiBackup(MAGIC, "password-backup"), { message: "non è un backup di Polpo Studio" });
  const conIntestazione = (h) => {
    const b = utf8(JSON.stringify(h));
    return unisci(MAGIC, u32be(b.length), b, new Uint8Array(40));
  };
  const buona = { format: "polpobak", version: 1, created: 0, kdf: { alg: "scrypt", n: 1024, r: 8, p: 1, salt: "AAAAAAAAAAAAAAAAAAAAAA==" } };
  await assert.rejects(leggiBackup(conIntestazione(buona), "password-backup"), { message: "password sbagliata oppure backup danneggiato" });
  for (const h of [
    { ...buona, format: "altro" },
    { ...buona, kdf: { ...buona.kdf, alg: "pbkdf2" } },
    { ...buona, kdf: { ...buona.kdf, n: 512 } },
    { ...buona, kdf: { ...buona.kdf, n: 2 ** 21 } },
    { ...buona, kdf: { ...buona.kdf, n: 1500 } },
    { ...buona, kdf: { ...buona.kdf, salt: "non base64" } },
    { ...buona, kdf: { ...buona.kdf, r: null } },
    { format: "polpobak" },
    [1, 2],
  ]) {
    await assert.rejects(leggiBackup(conIntestazione(h), "password-backup"), { name: "ErroreBackup", message: "intestazione del backup non valida" }, JSON.stringify(h));
  }
  const troncato = conIntestazione(buona).subarray(0, 30);
  await assert.rejects(leggiBackup(troncato, "password-backup"), { message: "intestazione del backup non valida" });
});

test("impronta diversa in un backup", async () => {
  // un backup «autentico» (cifrato con la password giusta) ma con un'impronta sbagliata
  const c = await nuova();
  await c.aggiungi("altro", "x", testo("dati"));
  const voce = c.voci()[0];
  const falsa = { voci: () => [{ ...voce, sha256: "0".repeat(64) }], leggi: (id) => c.leggi(id) };
  const { dati } = await esportaBackup(falsa, "password-backup", { kdfN: VELOCE });
  await assert.rejects(leggiBackup(dati, "password-backup"), { name: "ErroreBackup", message: "impronta diversa per x: backup alterato" });
});
