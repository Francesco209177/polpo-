// Il client Polpo Link: prima con un Polpo finto (casi difficili), poi con il firmware vero in WebAssembly.
import test from "node:test";
import assert from "node:assert/strict";
import { ClientLink, ErroreLink, STATO } from "../../../assets/js/studio/link/client.js";
import { TrasportoVirtuale } from "../../../assets/js/studio/link/trasporti.js";
import { FILE_MAX } from "../../../assets/js/studio/link/proto.js";
import { TrasportoFinto, percorsoWasm, polpoVero, premi, attendi } from "./aiuto.mjs";

const casuale = (n, seme = 1) => Uint8Array.from({ length: n }, () => (seme = (seme * 1103515245 + 12345) & 0x7fffffff) & 255);

async function clientFinto(regole, opzioni = {}) {
  const t = new TrasportoFinto(regole);
  const eventi = [], stati = [];
  const c = new ClientLink(t, { intervalloPing: 100, attesaOccupato: 30, suEvento: (e, d) => eventi.push([e, d]), suStato: (s) => stati.push(s), ...opzioni });
  await c.apri();
  Object.assign(c, { eventi, stati, finto: t });
  return c;
}

test("finto: sonda, hello, stati e file a blocchi", async () => {
  const c = await clientFinto();
  assert.deepEqual(await c.sonda(), { pong: true, proto: 1 });
  await c.hello();
  assert.deepEqual(c.stati, [STATO.APERTO, STATO.ATTESA, STATO.COLLEGATO]);
  for (const n of [0, 1, 767, 768, 769, 5000]) {
    const dati = casuale(n, n + 1);
    const avanzamento = [];
    await c.scriviFile("/polpo/logs/prova.bin", dati, (a, b) => avanzamento.push([a, b]));
    assert.deepEqual(c.finto.file.get("/polpo/logs/prova.bin"), dati);
    assert.deepEqual(await c.leggiFile("/polpo/logs/prova.bin"), dati);
    assert.deepEqual(avanzamento.at(-1), [n, n]);
  }
  await c.chiudi();
  assert.equal(c.stato, STATO.CHIUSO);
});

test("finto: percorso o dimensione sbagliati non partono", async () => {
  const c = await clientFinto();
  await c.hello();
  await assert.rejects(c.scriviFile("/polpo/con spazio.txt", Uint8Array.of(1)), (e) => e instanceof ErroreLink && e.codice === "bad_args");
  await assert.rejects(c.scriviFile("/polpo/logs/grande.bin", new Uint8Array(FILE_MAX + 1)), (e) => e.codice === "too_large");
  await assert.rejects(c.richiesta("ir.send", { raw: true, timings: Array(500).fill(1000) }), (e) => e.codice === "line_too_long");
  await c.chiudi();
});

test("finto: «busy» si riprova, una richiesta per volta", async () => {
  const c = await clientFinto({ occupato: 3 });
  const a = c.hello(), b = c.richiesta("info");
  assert.equal((await a).firmware, "finto");
  assert.equal((await b).board, "finto");
  const inviate = c.finto.ricevute.map((r) => r.cmd).filter((x) => x !== "ping");
  assert.deepEqual(inviate, ["hello", "hello", "hello", "hello", "info"]);
  await c.chiudi();
});

test("finto: blocco rovinato riletto, tre volte di fila è un errore", async () => {
  const c = await clientFinto({ rovinaBlocchi: 2 });
  await c.hello();
  c.finto.file.set("/polpo/a.bin", casuale(2000));
  assert.deepEqual(await c.leggiFile("/polpo/a.bin"), casuale(2000));
  c.finto.regole.rovinaBlocchi = 3;
  await assert.rejects(c.leggiFile("/polpo/a.bin"), (e) => e.codice === "io_error" && /cavo USB/.test(e.message));
  await c.chiudi();
});

test("finto: senza risposta scade il tempo, la porta resta aperta", async () => {
  const c = await clientFinto({ muto: ["hello"] });
  await assert.rejects(c.hello(300), (e) => e.codice === "timeout");
  assert.equal(c.stato, STATO.APERTO);
  await c.chiudi(false);
});

test("finto: protocollo diverso o nessuna risposta al ping", async () => {
  const c = await clientFinto({ proto: 2 });
  await assert.rejects(c.sonda(), (e) => e.codice === "unsupported");
  await c.chiudi(false);
  const m = await clientFinto({ muto: ["ping"] });
  await assert.rejects(m.sonda(200), (e) => e.codice === "not_polpo");
  await m.chiudi(false);
});

test("finto: «link.closed» dal Polpo e cavo staccato", async () => {
  const c = await clientFinto({ muto: ["info"] });
  await c.hello();
  const pendente = c.richiesta("info");
  c.finto.manda({ ev: "link.closed", data: {} });
  await assert.rejects(pendente, (e) => e.codice === "not_connected");
  assert.equal(c.stato, STATO.APERTO);
  assert.deepEqual(c.eventi.map((e) => e[0]), ["link.closed"]);
  const altra = c.richiesta("info");
  c.finto.scollega();
  await assert.rejects(altra, (e) => e.codice === "closed" && e.message === "Polpo scollegato");
  assert.equal(c.stato, STATO.CHIUSO);
  await assert.rejects(c.richiesta("info"), (e) => e.codice === "closed");
});

test("finto: dopo tre ping senza risposta «non risponde», poi di nuovo sì", async () => {
  const c = await clientFinto({}, { intervalloPing: 50 });
  await c.hello();
  c.finto.regole.muto = ["ping"];
  const fine = Date.now() + 25000;
  while (c.risponde && Date.now() < fine) await attendi(100);
  assert.equal(c.risponde, false);
  c.finto.regole.muto = [];
  while (!c.risponde && Date.now() < fine) await attendi(50);
  assert.equal(c.risponde, true);
  await c.chiudi();
});

// ---------------- il firmware vero ----------------

const senzaFirmware = percorsoWasm() ? false : "manca polpo-sim.wasm (POLPO_SIM_WASM o site/_site): prove sul firmware saltate";

async function collegaVero() {
  const polpo = await polpoVero();
  const eventi = [];
  const c = new ClientLink(new TrasportoVirtuale(polpo), { suEvento: (e, d) => eventi.push([e, d]) });
  await c.apri();
  c.eventi = eventi;
  assert.deepEqual(await c.sonda(), { pong: true, proto: 1 });
  const hello = c.hello();
  await attendi(400);
  await premi(polpo, "destra"); // sullo schermo del Polpo: «Sì»
  await premi(polpo, "ok");
  const info = await hello;
  return { c, polpo, info };
}

test("firmware vero: collegamento accettato sullo schermo, info, file", { skip: senzaFirmware }, async (t) => {
  const { c, info } = await collegaVero();
  t.after(() => c.chiudi(false));
  assert.equal(c.stato, STATO.COLLEGATO);
  assert.equal(c.simulato, true);
  assert.equal(info.proto, 1);
  assert.match(info.firmware, /^\d+\.\d+\.\d+/);
  const elenco = await c.richiesta("fs.list", { path: "/polpo" });
  assert.ok(elenco.entries.some((e) => e.name === "script" && e.dir));
  for (const n of [0, 1, 768, 769, 3000]) {
    const dati = casuale(n, 3 * n + 1);
    await c.scriviFile("/polpo/logs/prova.bin", dati);
    assert.deepEqual(await c.leggiFile("/polpo/logs/prova.bin"), dati, `${n} byte`);
  }
  await assert.rejects(c.richiesta("fs.read", { path: "/../segreto.txt", offset: 0, len: 16 }), (e) => e.codice === "bad_args");
  await c.chiudi();
  assert.equal(c.stato, STATO.CHIUSO);
});

test("firmware vero: un codice radio ricevuto arriva come evento", { skip: senzaFirmware }, async (t) => {
  const { c, polpo } = await collegaVero();
  t.after(() => c.chiudi(false));
  polpo.mondo({ cmd: "modulo", valore: "rf433" });
  await c.richiesta("rf.rx.start");
  polpo.mondo({ cmd: "radiocomando", valore: 5592405, bit: 24 });
  const fine = Date.now() + 5000;
  while (!c.eventi.some((e) => e[0] === "rf.code") && Date.now() < fine) await attendi(50);
  const [, dati] = c.eventi.find((e) => e[0] === "rf.code");
  assert.equal(parseInt(dati.value, 16), 5592405);
  assert.equal(dati.bits, 24);
  await c.richiesta("rf.rx.stop");
  await c.chiudi();
});

test("firmware vero: senza conferma sul Polpo il collegamento non parte", { skip: senzaFirmware }, async (t) => {
  const polpo = await polpoVero();
  const c = new ClientLink(new TrasportoVirtuale(polpo));
  t.after(() => c.chiudi(false));
  await c.apri();
  await assert.rejects(c.richiesta("info"), (e) => e.codice === "not_connected");
  const esito = c.hello().then(() => null, (e) => e);
  await attendi(400);
  await premi(polpo, "ok"); // «No» è la scelta predefinita
  const e = await esito;
  assert.ok(e instanceof ErroreLink && e.codice === "denied", String(e && e.codice));
  assert.equal(c.stato, STATO.APERTO);
});
