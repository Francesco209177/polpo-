// Le pagine dell'app per Android (python site/build.py --app), provate in Chromium con lo schermo di un telefono
// e un finto «PolpoNativo» al posto dell'app. Si eseguono solo se APP_DIR indica la cartella costruita.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, devices, servi, apri, scriviWav } from "./aiuto.mjs";
import { trasmetti } from "../../assets/js/onde/tx.js";
import { canale, casuale } from "../../assets/js/onde/canale.js";

const APP = process.env.APP_DIR ? path.resolve(process.env.APP_DIR) : "";
const salta = APP && fs.existsSync(path.join(APP, "index.html")) ? false : "APP_DIR non indicata: prove delle pagine dell'app saltate";

// ciò che l'app offre alla pagina, registrato per controllarlo
const FINTO_NATIVO = () => {
  window.__chiamate = [];
  window.PolpoNativo = {
    versione: () => "prova",
    salvaFile: (nome, base64) => window.__chiamate.push(["salvaFile", nome, base64]),
    salvaRisorsa: (percorso, nome) => window.__chiamate.push(["salvaRisorsa", percorso, nome]),
  };
};

let server, browser;
before(async () => {
  if (salta) return;
  server = await servi(APP);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await server?.chiudi();
});

const telefono = () => ({ ...devices["Pixel 7"] });

test("nessuna pagina va fuori dallo schermo del telefono né chiede nulla ad altri siti", { skip: salta }, async () => {
  const pagine = ["", "simulatore/", "installa/", "studio/", "telefono/", "onde/", "componenti/", "documentazione/", "documentazione/manuale-polpo.html", "documentazione/polposcript.html"];
  for (const p of pagine) {
    const { pagina, contesto, problemi } = await apri(browser, server.base, p, telefono());
    const largo = await pagina.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(largo <= 1, `${p || "pagina iniziale"}: ${largo} px oltre il bordo dello schermo`);
    assert.deepEqual(problemi, [], p);
    await contesto.close();
  }
});

test("Installa: niente Web Serial, lo zip per la microSD si salva con il selettore di Android", { skip: salta }, async () => {
  const contesto = await browser.newContext(telefono());
  await contesto.addInitScript(FINTO_NATIVO);
  const pagina = await contesto.newPage();
  let scaricati = 0;
  pagina.on("download", () => scaricati++);
  await pagina.goto(server.base + "installa/", { waitUntil: "networkidle" });
  assert.equal(await pagina.locator("esp-web-install-button").count(), 0);
  assert.equal(await pagina.locator("[data-app-installa]").count(), 1);
  // il link al sito pubblicato (si apre nel browser del telefono)
  assert.match(await pagina.getByRole("link", { name: "Apri la pagina Installa nel browser" }).getAttribute("href"), /^https:\/\/.+\/installa\/$/);
  await pagina.getByRole("link", { name: "Salva sd-polpo.zip" }).click();
  const chiamate = await pagina.evaluate(() => window.__chiamate);
  assert.equal(chiamate.length, 1);
  assert.equal(chiamate[0][0], "salvaRisorsa");
  assert.match(chiamate[0][1], /\/installa\/sd-polpo\.zip$/);
  assert.equal(chiamate[0][2], "sd-polpo.zip");
  assert.equal(scaricati, 0, "nell'app il download del browser non parte");
  assert.equal(new URL(pagina.url()).pathname.endsWith("/installa/"), true, "la pagina resta la stessa");
  await contesto.close();
});

test("Onde: la registrazione si salva con il selettore di Android, come file WAV", { skip: salta }, async () => {
  const fsAudio = 48000;
  const cartella = fs.mkdtempSync(path.join(os.tmpdir(), "polpo-app-"));
  const wav = path.join(cartella, "microfono.wav");
  scriviWav(wav, canale(trasmetti("Dal telefono", fsAudio).audio, fsAudio, { snr: 15, anticipo: 1, coda: 1.5, guadagno: 0.5 }, casuale(7)), fsAudio);
  const conMicrofono = await chromium.launch({
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`, "--autoplay-policy=no-user-gesture-required"],
  });
  try {
    const contesto = await conMicrofono.newContext(telefono());
    await contesto.addInitScript(FINTO_NATIVO);
    const pagina = await contesto.newPage();
    await pagina.goto(server.base + "onde/", { waitUntil: "networkidle" });
    await pagina.click("#ascolta");
    await pagina.waitForFunction(() => document.querySelectorAll("#messaggi li").length >= 1, null, { timeout: 40000 });
    assert.equal(await pagina.locator("#messaggi li .onde-testo").first().textContent(), "Dal telefono");
    await pagina.click("#ascolta");
    await pagina.click("#scarica");
    await pagina.waitForFunction(() => window.__chiamate.length === 1, null, { timeout: 5000 });
    const [tipo, nome, base64] = (await pagina.evaluate(() => window.__chiamate))[0];
    assert.equal(tipo, "salvaFile");
    assert.equal(nome, "polpo-onde-registrazione.wav");
    const dati = Buffer.from(base64, "base64");
    assert.equal(dati.subarray(0, 4).toString(), "RIFF");
    assert.ok(dati.length > 44 + 2 * 44100, "almeno un secondo di audio");
  } finally {
    await conMicrofono.close();
    fs.rmSync(cartella, { recursive: true, force: true });
  }
});

test("la pagina Telefono dell'app parla dell'app, non del download", { skip: salta }, async () => {
  const { pagina, contesto } = await apri(browser, server.base, "telefono/", telefono());
  assert.equal(await pagina.locator("[data-app-telefono]").count(), 1);
  assert.match(await pagina.locator("h1").textContent(), /Stai usando l'app Polpo/);
  await contesto.close();
});
