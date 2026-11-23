// La porta seriale «come Web Serial» sopra PolpoNativo (aggiornamento/porta.js), da sola e sotto il Transport di
// esptool-js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PortaSerialeNativa } from "../../../assets/js/studio/aggiornamento/porta.js";
import { ESPLoader, Transport } from "../../../assets/js/terze-parti/esptool-js-0.7.1/bundle.js";
import { NativoUsbFinto } from "./nativo_usb_finto.mjs";
import { slip } from "./esp32s3_finto.mjs";
import { STUB_S3, calma } from "./aiuto.mjs";

const b64 = (a) => Buffer.from(a).toString("base64");
const evento = (ev) => setImmediate(() => globalThis.__polpoNativo(ev));

/** Un ponte minimo: registra le chiamate; l'apertura risponde come si sceglie. */
function ponte({ apri = "ok", scrivi = true } = {}) {
  const p = {
    chiamate: [],
    scritto: [],
    serialeApri(id, opzioni) {
      p.chiamate.push(["serialeApri", id, JSON.parse(opzioni)]);
      if (apri === "ok") evento({ tipo: "seriale.aperta", nome: "prova" });
      else if (apri === "errore") evento({ tipo: "seriale.errore", messaggio: "Permesso USB negato" });
      else if (apri === "vecchia-chiusura") {
        evento({ tipo: "seriale.chiusa", motivo: "porta chiusa" }); // di una porta di prima
        evento({ tipo: "seriale.aperta", nome: "prova" });
      }
    },
    serialeScrivi(b) {
      p.chiamate.push(["serialeScrivi", b.length]);
      p.scritto.push(...Buffer.from(b, "base64"));
      return scrivi;
    },
    serialeLinee(dtr, rts) {
      p.chiamate.push(["serialeLinee", dtr, rts]);
      return true;
    },
    serialeBaud(baud) {
      p.chiamate.push(["serialeBaud", baud]);
      return true;
    },
    serialeChiudi() {
      p.chiamate.push(["serialeChiudi"]);
    },
  };
  return p;
}

const POLPO = { id: 7, nome: "USB JTAG/serial debug unit", vid: 0x303a, pid: 0x1001 };

test("apertura: serialeApri con id e opzioni in JSON (DTR e RTS bassi), getInfo con VID e PID", async () => {
  const n = ponte();
  const porta = new PortaSerialeNativa(n, POLPO);
  assert.deepEqual(porta.getInfo(), { usbVendorId: 0x303a, usbProductId: 0x1001 });
  assert.equal(porta.readable, null);
  await porta.open({ baudRate: 115200 });
  assert.deepEqual(n.chiamate, [["serialeApri", "7", { baud: 115200, dtr: false, rts: false }]]);
  assert.ok(porta.readable instanceof ReadableStream && porta.writable instanceof WritableStream);
  await assert.rejects(porta.open({ baudRate: 115200 }), /già aperta/);
  await porta.close();
  assert.deepEqual(n.chiamate.at(-1), ["serialeChiudi"]);
  assert.equal(porta.readable, null);
  assert.equal(porta.writable, null);
  await porta.open({ baudRate: 115200 }); // si riapre (esptool-js lo fa per riprovare il riconoscimento)
  await porta.close();
  assert.deepEqual(new PortaSerialeNativa(n, { id: 1 }).getInfo(), { usbVendorId: undefined, usbProductId: undefined });
});

test("apertura rifiutata, scaduta, a 1200 baud; una chiusura vecchia prima di «aperta» non conta", async () => {
  await assert.rejects(new PortaSerialeNativa(ponte({ apri: "errore" }), POLPO).open({ baudRate: 115200 }), /Permesso USB negato/);
  await assert.rejects(new PortaSerialeNativa(ponte({ apri: "mai" }), POLPO, { tempoApertura: 50 }).open({ baudRate: 115200 }), (e) => e.name === "TimeoutError");
  const n = ponte();
  await assert.rejects(new PortaSerialeNativa(n, POLPO).open({ baudRate: 1200 }), /1200 baud/);
  assert.deepEqual(n.chiamate, [], "a 1200 baud non chiede niente al telefono");
  const porta = new PortaSerialeNativa(ponte({ apri: "vecchia-chiusura" }), POLPO);
  await porta.open({ baudRate: 115200 });
  await calma(20);
  assert.equal(porta.aperta, true);
  await porta.close();
});

test("lettura: «seriale.dati» in base64 diventa il flusso readable, in ordine; scrittura a blocchi", async () => {
  const n = ponte();
  const porta = new PortaSerialeNativa(n, POLPO, { bloccoScrittura: 1000 });
  await porta.open({ baudRate: 115200 });
  evento({ tipo: "seriale.dati", dati: b64([1, 2, 3]) });
  evento({ tipo: "seriale.dati", dati: "non base64!" }); // ignorato
  evento({ tipo: "seriale.dati", dati: b64([4]) });
  const l = porta.readable.getReader();
  const a = await l.read();
  const b = await l.read();
  assert.deepEqual([...a.value, ...b.value], [1, 2, 3, 4]);
  l.releaseLock();
  const w = porta.writable.getWriter();
  const dati = Uint8Array.from({ length: 2500 }, (_, i) => i & 255);
  await w.write(dati);
  assert.deepEqual(n.chiamate.filter((c) => c[0] === "serialeScrivi").length, 3);
  assert.deepEqual(n.scritto, [...dati]);
  w.releaseLock();
  await porta.close();
  const rotto = new PortaSerialeNativa(ponte({ scrivi: false }), POLPO);
  await rotto.open({ baudRate: 115200 });
  await assert.rejects(rotto.writable.getWriter().write(new Uint8Array([1])), /Scrittura sulla porta USB non riuscita/);
});

test("setSignals: una linea per volta come fa esptool-js, al ponte vanno sempre tutte e due; setBaudRate", async () => {
  const n = ponte();
  const porta = new PortaSerialeNativa(n, POLPO);
  await assert.rejects(porta.setSignals({ requestToSend: true }), /chiusa/);
  await porta.open({ baudRate: 115200 });
  await porta.setSignals({ requestToSend: true });
  await porta.setSignals({ dataTerminalReady: true });
  await porta.setSignals({ dataTerminalReady: false, requestToSend: false, break: undefined });
  await porta.setBaudRate(460800);
  await assert.rejects(porta.setBaudRate(1200), /non ammessa/);
  assert.deepEqual(n.chiamate.slice(1), [
    ["serialeLinee", false, true],
    ["serialeLinee", true, true],
    ["serialeLinee", false, false],
    ["serialeBaud", 460800],
  ]);
  await porta.close();
});

test("cavo staccato: il flusso finisce con NetworkError, scollegata, ondisconnect; la chiusura non richiama il ponte", async () => {
  const n = ponte();
  const porta = new PortaSerialeNativa(n, POLPO);
  let avvisato = false;
  porta.ondisconnect = () => (avvisato = true);
  await porta.open({ baudRate: 115200 });
  const l = porta.readable.getReader();
  const lettura = l.read();
  evento({ tipo: "seriale.chiusa", motivo: "scollegato" });
  await assert.rejects(lettura, (e) => e.name === "NetworkError");
  assert.equal(porta.scollegata, true);
  assert.equal(porta.connected, false);
  assert.equal(avvisato, true);
  await assert.rejects(porta.writable.getWriter().write(new Uint8Array([1])), /scollegato/);
  l.releaseLock();
  const prima = n.chiamate.length;
  await porta.close();
  assert.equal(n.chiamate.length, prima, "niente serialeChiudi: la porta è già chiusa");
  await assert.rejects(porta.open({ baudRate: 115200 }), /scollegato/);
});

test("Transport di esptool-js sopra la porta: SLIP in uscita, pacchetti spezzati in tanti eventi in entrata", async () => {
  const n = ponte();
  const porta = new PortaSerialeNativa(n, POLPO);
  const t = new Transport(porta, false);
  t.trace = () => {};
  await t.connect(115200);
  t.readLoop();
  await t.write(new Uint8Array([0x00, 0xc0, 0xdb, 0x01]));
  assert.deepEqual(n.scritto, [0xc0, 0x00, 0xdb, 0xdc, 0xdb, 0xdd, 0x01, 0xc0]);
  const pkt = slip([1, 2, 0xc0, 3, 0xdb, 4]);
  for (const b of pkt) evento({ tipo: "seriale.dati", dati: b64([b]) });
  assert.deepEqual([...(await t.read(1000))], [1, 2, 0xc0, 3, 0xdb, 4]);
  assert.equal(t.getPid(), 0x1001);
  await t.disconnect();
  assert.deepEqual(n.chiamate.at(-1), ["serialeChiudi"]);
});

test("esptool-js da solo, sull'ESP32-S3, leggerebbe registri dell'ESP32 (per questo firmware.js nasconde getChipRevision)", async (t) => {
  const nativo = new NativoUsbFinto({ inizio: "rom", chipRom: { stubAtteso: STUB_S3 } });
  const porta = new PortaSerialeNativa(nativo, JSON.parse(nativo.usbElenco())[0]);
  const transport = new Transport(porta, false);
  transport.trace = () => {};
  const loader = new ESPLoader({ transport, baudrate: 115200, romBaudrate: 115200, terminal: { clean() {}, write() {}, writeLine() {} } });
  await loader.connect("no_reset", 3, true);
  assert.equal(loader.chip.CHIP_NAME, "ESP32-S3");
  await loader.runStub();
  assert.equal(loader.IS_STUB, true);
  const strani = nativo.esp.fuoriMappa.map((a) => a.toString(16));
  t.diagnostic(`letture fuori dalla mappa dell'ESP32-S3: ${strani.join(", ") || "nessuna"}`);
  assert.ok(strani.includes("3ff5a00c"), "se esptool-js non lo fa più, la correzione in firmware.js si può togliere");
  await transport.disconnect();
});
