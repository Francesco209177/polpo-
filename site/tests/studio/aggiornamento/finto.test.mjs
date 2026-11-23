// L'ESP32-S3 finto delle prove (esp32s3_finto.mjs) si comporta come la ROM vera nei punti che contano: pacchetti
// SLIP con escape, SYNC con 8 risposte, stato a 4 byte, reset e bootloader con le linee dell'USB-Serial-JTAG.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Esp32s3Finto, REG, slip } from "./esp32s3_finto.mjs";

const le32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const richiesta = (op, dati, controllo = 0) => slip([0, op, dati.length & 0xff, dati.length >> 8, ...le32(controllo), ...dati]);

/** Le risposte (senza SLIP) che il finto manda per `byte`. */
function risposte(esp, byte) {
  const fuori = [];
  esp.invia = (b) => {
    const p = [];
    for (let i = 1; i < b.length - 1; i++) {
      if (b[i] === 0xdb) p.push(b[++i] === 0xdc ? 0xc0 : 0xdb);
      else p.push(b[i]);
    }
    fuori.push(p);
  };
  esp.ricevi(byte);
  return fuori;
}

test("SYNC: la ROM risponde 8 volte con un valore diverso da 0 e 4 byte di stato", () => {
  const esp = new Esp32s3Finto();
  esp.modo = "rom";
  const r = risposte(esp, richiesta(0x08, [7, 7, 0x12, 0x20, ...new Array(32).fill(0x55)]));
  assert.equal(r.length, 8);
  for (const p of r) {
    assert.deepEqual(p.slice(0, 4), [1, 0x08, 4, 0]);
    assert.notEqual(p[4] | p[5] | p[6] | p[7], 0);
    assert.deepEqual(p.slice(8), [0, 0, 0, 0]);
  }
  assert.deepEqual(risposte(esp, richiesta(0x08, [1, 2, 3])), [], "un SYNC sbagliato non ha risposta");
});

test("SLIP: valori con 0xC0 e 0xDB passano nei due sensi (WRITE_REG e READ_REG)", () => {
  const esp = new Esp32s3Finto();
  esp.modo = "rom";
  const a = 0x3fc90000, v = 0xc0dbc0db;
  risposte(esp, richiesta(0x09, [...le32(a), ...le32(v), ...le32(0xffffffff), ...le32(0)]));
  const [p] = risposte(esp, richiesta(0x0a, le32(a)));
  assert.equal((p[4] | (p[5] << 8) | (p[6] << 16) | (p[7] << 24)) >>> 0, v);
  // spezzato in tanti pezzi arriva lo stesso
  const pezzi = richiesta(0x0a, le32(REG.MAGIA));
  const fuori = [];
  esp.invia = (b) => fuori.push(b);
  for (const b of pezzi) esp.ricevi([b]);
  assert.equal(fuori.length, 1);
});

test("linee USB-Serial-JTAG: (DTR 0, RTS 1) è il reset; si torna nel bootloader con FORCE_DOWNLOAD_BOOT o DTR alto prima", () => {
  const esp = new Esp32s3Finto();
  assert.equal(esp.toccoA1200(), true, "il tocco a 1200 baud col firmware");
  assert.deepEqual(esp.riavvii, ["rom"]);
  assert.equal(esp.reg(REG.RTC_OPTION1) & 1, 1);
  esp.impostaLinee(false, true);
  assert.equal(esp.modo, "reset");
  esp.impostaLinee(false, false);
  assert.equal(esp.modo, "rom", "senza togliere FORCE_DOWNLOAD_BOOT si torna nel bootloader");
  esp.registri.set(REG.RTC_OPTION1, 0);
  esp.impostaLinee(false, true);
  esp.impostaLinee(false, false);
  assert.equal(esp.modo, "app", "tolto il bit, riparte l'applicazione");
  esp.modo = "rom";
  for (const [d, r] of [[false, false], [true, false], [true, true], [false, true], [false, false]]) esp.impostaLinee(d, r);
  assert.equal(esp.modo, "rom", "la sequenza UsbJtagSerialReset di esptool porta nel bootloader");
  assert.equal(esp.toccoA1200(), false, "nella ROM i 1200 baud non fanno niente");
});
