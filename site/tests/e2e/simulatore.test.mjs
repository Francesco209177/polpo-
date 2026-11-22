// Il simulatore con il firmware vero, nel browser (Chromium): le schermate devono essere le stesse delle prove per PC.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices, servi, apri, SITO } from "./aiuto.mjs";

const qui = path.dirname(fileURLToPath(import.meta.url));
const haFirmware = fs.existsSync(path.join(SITO, "simulatore/polpo-sim.wasm"));
const salta = haFirmware ? false : "il sito è stato costruito senza --firmware-web (serve Emscripten): prova del simulatore saltata";

// le impronte attese delle schermate sono quelle delle prove del firmware per PC (polpo/sim/tests)
const attese = Object.fromEntries(
  fs.readFileSync(path.join(qui, "../../../polpo/sim/tests/01_avvio.atteso"), "utf8").split("\n")
    .filter((r) => r.startsWith("schermo ")).map((r) => r.split(" ").slice(1)),
);

let server, browser;
before(async () => {
  server = await servi();
  browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
});
after(async () => {
  await browser?.close();
  await server?.chiudi();
});

const impronta = (pagina) => pagina.evaluate(() => window.__sim.polpo.impronta().toString(16).padStart(8, "0"));
async function aspettaSchermo(pagina, nome) {
  await pagina.waitForFunction((h) => window.__sim.polpo.impronta().toString(16).padStart(8, "0") === h, attese[nome], { timeout: 8000 })
    .catch(async () => assert.fail(`schermata «${nome}»: attesa ${attese[nome]}, ottenuta ${await impronta(pagina)}`));
}
async function pronto(percorso = "simulatore/", opzioni) {
  const r = await apri(browser, server.base, percorso, opzioni);
  await r.pagina.waitForFunction(() => window.__sim && window.__sim.pronto, null, { timeout: 20000 });
  await r.pagina.locator("#schermo").click(); // il fuoco sullo schermo, come farebbe chi guarda
  return r;
}
const tasti = async (pagina, ...nomi) => { for (const n of nomi) { await pagina.keyboard.press(n, { delay: 70 }); await pagina.waitForTimeout(130); } };

test("si accende e mostra le stesse schermate del firmware per PC", { skip: salta }, async () => {
  const { pagina, contesto, problemi } = await pronto();
  assert.match(await pagina.locator("#sim-stato").textContent(), /Polpo acceso/);
  // la scrivania è animata (la mascotte si muove): si controlla che lo schermo non sia vuoto e abbia i colori giusti
  const colori = await pagina.evaluate(() => {
    const c = document.getElementById("schermo"), d = c.getContext("2d").getImageData(0, 0, 240, 135).data, visti = new Set();
    for (let i = 0; i < d.length; i += 4) visti.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    return visti.size;
  });
  assert.ok(colori >= 6, `scrivania disegnata (${colori} colori)`);
  // le schermate ferme devono coincidere punto per punto con quelle delle prove per PC
  await tasti(pagina, "Enter");
  await aspettaSchermo(pagina, "menu");
  await tasti(pagina, "Enter");
  await aspettaSchermo(pagina, "infrarossi");
  await tasti(pagina, "Escape");
  await aspettaSchermo(pagina, "menu");
  await tasti(pagina, "ArrowDown", "ArrowDown", "Enter");
  await aspettaSchermo(pagina, "nfc");
  // il tasto laterale G0 torna indietro
  await pagina.click("#g0");
  // il menu ricorda la posizione, quindi non è la schermata «menu» di prima: basta che non sia più l'app
  await pagina.waitForFunction((h) => window.__sim.polpo.impronta().toString(16).padStart(8, "0") !== h, attese.nfc, { timeout: 8000 })
    .catch(() => assert.fail("il tasto G0 non ha chiuso l'app NFC"));
  assert.deepEqual(problemi, []);
  await contesto.close();
});

test("la tastiera a schermo comanda il Polpo", { skip: salta }, async () => {
  const { pagina, contesto, problemi } = await pronto();
  assert.equal(await pagina.locator("#tastiera button").count(), 56);
  await pagina.locator('#tastiera button[aria-label="OK, invio"]').click({ delay: 90 });
  await aspettaSchermo(pagina, "menu");
  await pagina.locator('#tastiera button[aria-label="OK, invio"]').click({ delay: 90 });
  await aspettaSchermo(pagina, "infrarossi");
  await pagina.locator('#tastiera button[aria-label="indietro"]').click({ delay: 90 });
  await aspettaSchermo(pagina, "menu");
  assert.deepEqual(problemi, []);
  await contesto.close();
});

test("pressioni brevissime, anche tutte nello stesso istante, non vanno perse", { skip: salta }, async () => {
  const { pagina, contesto, problemi } = await pronto();
  // premuto e rilasciato prima che il browser disegni un altro fotogramma: capita quando la pagina rallenta
  const lampo = (tasto, volte = 1) => pagina.evaluate(([t, n]) => {
    for (let i = 0; i < n; i++) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: t, code: "Prova" + t, bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keyup", { key: t, code: "Prova" + t, bubbles: true }));
    }
  }, [tasto, volte]);
  await lampo("Enter");
  await aspettaSchermo(pagina, "menu");
  await lampo("Escape");
  await pagina.waitForFunction((h) => window.__sim.polpo.impronta().toString(16).padStart(8, "0") !== h, attese.menu, { timeout: 8000 })
    .catch(() => assert.fail("la pressione lampo di «indietro» è andata persa"));
  // cinque «coccole» nello stesso istante: il Polpo deve contarle tutte e cinque, una dopo l'altra
  const punti = () => pagina.evaluate(() => {
    const b = window.__sim.polpo.statoEsporta(), t = new TextDecoder("latin1").decode(b), i = t.indexOf("\u0002\u0000\u0000\u0000xp");
    return i < 0 ? null : new DataView(b.buffer).getUint32(i + 6, true);
  });
  await lampo("p", 5);
  for (let i = 0; i < 50 && (await punti()) !== 5; i++) await pagina.waitForTimeout(100);
  assert.equal(await punti(), 5);
  assert.deepEqual(problemi, []);
  await contesto.close();
});

test("infrarossi: il telecomando universale del Polpo accende il televisore finto", { skip: salta }, async () => {
  const { pagina, contesto, problemi } = await pronto();
  assert.equal(await pagina.locator("#tv").textContent(), "TV spenta");
  await tasti(pagina, "Enter", "Enter", "Enter", "Enter"); // menu, Infrarossi, Universale: televisori, Accendi / spegni
  await pagina.waitForFunction(() => document.getElementById("tv").textContent.startsWith("TV accesa"), null, { timeout: 15000 });
  assert.match(await pagina.locator("#registro").textContent(), /Infrarossi dal Polpo: NEC, indirizzo 4, comando 8\. Il televisore ha reagito\./);
  assert.deepEqual(problemi, []);
  await contesto.close();
});

test("tastiera USB: dopo la conferma il Polpo «scrive» sul computer finto", { skip: salta }, async () => {
  const { pagina, contesto, problemi } = await pronto();
  await tasti(pagina, "Enter", "ArrowDown", "ArrowDown", "ArrowDown", "Enter", "ArrowDown", "ArrowDown", "Enter"); // BadUSB › Prova
  await pagina.waitForTimeout(300);
  await tasti(pagina, "Enter"); // OK sul «No» predefinito: non deve scrivere nulla
  await pagina.waitForTimeout(1500);
  assert.equal(await pagina.locator("#pc-testo").inputValue(), "");
  await tasti(pagina, "Enter");
  await pagina.waitForTimeout(300);
  await tasti(pagina, "ArrowRight", "Enter"); // Sì
  await pagina.waitForFunction(() => document.getElementById("pc-testo").value === "Ciao dal Polpo", null, { timeout: 15000 });
  assert.deepEqual(problemi, []);
  await contesto.close();
});

test("radio 433 MHz: il Polpo riceve il codice del telecomando finto e, ritrasmettendolo, accende la presa", { skip: salta }, async () => {
  const { pagina, contesto, problemi } = await pronto();
  await tasti(pagina, "Enter", "ArrowDown", "Enter", "Enter"); // Radio 433 MHz › Ricevi codici fissi
  await pagina.click('[data-rf="5393"]'); // senza moduli collegati non arriva nulla, e la pagina lo dice
  assert.match(await pagina.locator("#registro li").first().textContent(), /nessun ricevitore 433 collegato/);
  await pagina.selectOption("#grove", "rf433");
  await pagina.click('[data-rf="5393"]');
  await pagina.waitForTimeout(1200);
  await pagina.locator("#schermo").click();
  await tasti(pagina, "Enter", "ArrowDown", "Enter"); // azioni › Ritrasmetti
  await pagina.waitForFunction(() => document.getElementById("presa").textContent === "Presa accesa", null, { timeout: 10000 });
  assert.match(await pagina.locator("#registro").textContent(), /Radio 433 MHz dal Polpo: codice 5393 \(24 bit\)/);
  assert.deepEqual(problemi, []);
  await contesto.close();
});

test("microSD e impostazioni restano dopo aver ricaricato la pagina, e si possono cancellare", { skip: salta }, async () => {
  const { pagina, contesto, problemi } = await pronto();
  // i punti esperienza (tasto «p» sulla scrivania) finiscono nelle impostazioni del Polpo; il firmware li scrive
  // ogni cinque, per non consumare la memoria del dispositivo
  const punti = () => pagina.evaluate(() => {
    const b = window.__sim.polpo.statoEsporta(), t = new TextDecoder("latin1").decode(b), i = t.indexOf("\u0002\u0000\u0000\u0000xp");
    return i < 0 ? null : new DataView(b.buffer).getUint32(i + 6, true);
  });
  await tasti(pagina, "p", "p", "p", "p", "p");
  for (let i = 0; i < 50 && (await punti()) !== 5; i++) await pagina.waitForTimeout(100); // il Polpo li conta nel suo tempo
  assert.equal(await punti(), 5);
  await pagina.reload({ waitUntil: "networkidle" });
  await pagina.waitForFunction(() => window.__sim && window.__sim.pronto);
  assert.equal(await punti(), 5, "dopo il ricaricamento i punti ci sono ancora");
  pagina.once("dialog", (d) => d.accept());
  await pagina.click("#azzera");
  await pagina.waitForFunction(() => /stato iniziale/.test(document.getElementById("registro").textContent));
  assert.equal(await punti(), 0);
  assert.deepEqual(problemi, []);
  await contesto.close();
});

test("telefono: niente scorrimento orizzontale, tasti toccabili; il simulatore precedente c'è ancora", { skip: salta }, async () => {
  const { pagina, contesto, problemi } = await pronto("simulatore/", { ...devices["iPhone 13"] });
  const sfora = await pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(sfora <= 0, `la pagina sfora di ${sfora} px`);
  // tasti piccoli come sul Cardputer, ma abbastanza distanti: almeno 24 px da un centro all'altro
  const a = await pagina.locator("#tastiera button").nth(15).boundingBox(), b = await pagina.locator("#tastiera button").nth(16).boundingBox();
  assert.ok(b.x - a.x >= 24 && a.height >= 32, `tasti toccabili (passo ${b.x - a.x} px, altezza ${a.height} px)`);
  await pagina.locator('#tastiera button[aria-label="OK, invio"]').tap();
  await aspettaSchermo(pagina, "menu");
  assert.deepEqual(problemi, []);
  await contesto.close();
  const vecchio = await apri(browser, server.base, "simulatore/classico/");
  assert.equal(await vecchio.pagina.locator("canvas#screen").count(), 1);
  assert.equal(await vecchio.pagina.locator('nav.psb a[href="../../installa/"]').count(), 1);
  assert.deepEqual(vecchio.problemi, []);
  await vecchio.contesto.close();
});
