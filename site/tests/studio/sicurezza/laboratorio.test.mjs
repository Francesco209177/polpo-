// Modalità laboratorio (laboratorio.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { AZIONI, ModalitaLaboratorio, PermessoNegato, REGOLE, confermaPerLaboratorio } from "../../../assets/js/studio/sicurezza/laboratorio.js";
import { Cassaforte } from "../../../assets/js/studio/sicurezza/cassaforte.js";
import { ArchivioMemoria } from "../../../assets/js/studio/sicurezza/archivio.js";

test("si spegne da sola e protegge le azioni", () => {
  let ora = 1000;
  const eventi = [];
  const lab = new ModalitaLaboratorio({ alCambio: (on) => eventi.push(on), adesso: () => ora });
  assert.throws(() => lab.richiedi("rf.tx"), (e) => e instanceof PermessoNegato && e.message.includes("modalità laboratorio"));
  assert.throws(() => lab.richiedi("rf.tx"), { message: "Per trasmettere a 433 MHz serve la modalità laboratorio (Sicurezza › Modalità laboratorio)." });
  assert.ok(!lab.abilitata && lab.secondiRimasti === 0);
  lab.abilita(1);
  lab.richiedi("rf.tx");
  assert.ok(lab.secondiRimasti > 0 && lab.secondiRimasti <= 60);
  ora += 59.5;
  assert.equal(lab.secondiRimasti, 0); // int() di Python: 0,5 secondi → 0
  assert.ok(lab.abilitata);
  ora += 1; // scaduta
  assert.ok(!lab.abilitata);
  assert.deepEqual(eventi, [true, false]);
  assert.ok(!lab.abilitata);
  assert.deepEqual(eventi, [true, false]); // avvisa una volta sola
  assert.throws(() => lab.richiedi("azione.inventata"), RangeError);
  assert.throws(() => lab.richiedi("toString"), RangeError);
  lab.abilita(0); // almeno un minuto
  assert.equal(lab.secondiRimasti, 60);
  lab.disabilita();
  lab.disabilita(); // spegnere una modalità spenta non avvisa
  assert.deepEqual(eventi, [true, false, true, false]);
  assert.equal(Object.keys(AZIONI).length, 6);
  assert.ok(REGOLE.startsWith("Userò queste funzioni solo con dispositivi miei"));
});

test("con l'orologio vero", () => {
  const lab = new ModalitaLaboratorio();
  lab.abilita(30);
  assert.ok(lab.abilitata && lab.secondiRimasti > 1790);
});

test("conferma con PIN o frase (finestra «Modalità laboratorio»)", async () => {
  const c = await Cassaforte.apri(new ArchivioMemoria(), { kdfN: 2 ** 10 });
  await c.crea("una frase abbastanza lunga");
  assert.deepEqual(await confermaPerLaboratorio(c, "una frase abbastanza lunga"), { giusto: true, chiusa: false });
  assert.deepEqual(await confermaPerLaboratorio(c, "1234"), { giusto: false, chiusa: false }); // senza PIN è una frase
  await c.impostaPin("2468");
  assert.deepEqual(await confermaPerLaboratorio(c, "2468"), { giusto: true, chiusa: false });
  for (let i = 0; i < 4; i++) assert.deepEqual(await confermaPerLaboratorio(c, "0000"), { giusto: false, chiusa: false });
  assert.deepEqual(await confermaPerLaboratorio(c, "0000"), { giusto: false, chiusa: true });
});
