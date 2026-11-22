// Dieci minuti di audio che non contiene messaggi: il ricevitore non deve mai inventarne uno.
import test from "node:test";
import assert from "node:assert/strict";
import { Ricevitore } from "../../assets/js/onde/rx.js";
import { trasmetti } from "../../assets/js/onde/tx.js";
import { canale } from "../../assets/js/onde/canale.js";
import { casuale, nonMessaggi } from "./aiuto.mjs";

const fs = 48000;

for (const [nome, genera] of Object.entries(nonMessaggi)) {
  test(`nessun falso messaggio in 2 minuti di: ${nome}`, (t) => {
    const rnd = casuale(nome.length * 131);
    const conta = { messaggio: 0, aggancio: 0, scartato: 0, fallito: 0, intestazione: 0 };
    const rx = new Ricevitore(fs, { suEvento: (e) => conta[e.tipo]++ });
    for (let s = 0; s < 120; s += 10) {
      const y = genera(10 * fs, fs, rnd);
      for (let i = 0; i < y.length; i += 4096) rx.accoda(y.subarray(i, i + 4096));
    }
    t.diagnostic(`${nome}: ${JSON.stringify(conta)}`);
    assert.equal(conta.messaggio, 0);
    assert.equal(conta.intestazione, 0, "nemmeno un'intestazione valida");
    assert.ok(Math.abs(rx.tempo - 120) < 0.01);
  });
}

test("dopo più di due minuti di rumore i messaggi veri arrivano ancora (la memoria è stata riciclata più volte)", () => {
  const rnd = casuale(9);
  const arrivati = [];
  const rx = new Ricevitore(fs, { suEvento: (e) => e.tipo === "messaggio" && arrivati.push(e) });
  const spingi = (y) => { for (let i = 0; i < y.length; i += 3000) rx.accoda(y.subarray(i, i + 3000)); };
  for (let s = 0; s < 130; s += 10) spingi(nonMessaggi["rumore bianco"](10 * fs, fs, rnd));
  for (const testo of ["Primo dopo due minuti", "Secondo, subito dopo"]) spingi(canale(trasmetti(testo, fs).audio, fs, { snr: 5, anticipo: 0.1, coda: 0.1 }, rnd));
  spingi(nonMessaggi["rumore bianco"](fs, fs, rnd));
  assert.deepEqual(arrivati.map((m) => m.testo), ["Primo dopo due minuti", "Secondo, subito dopo"]);
  assert.ok(arrivati[0].tempo > 130 && arrivati[0].tempo < 131, `istante del primo: ${arrivati[0].tempo}`);
});
