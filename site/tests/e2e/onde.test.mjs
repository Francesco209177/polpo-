// Polpo Onde nel browser vero (Chromium): pagina, canale simulato, trasmissione, ascolto con un file audio al posto del microfono.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { chromium, devices, servi, apri, scriviWav } from "./aiuto.mjs";
import { trasmetti } from "../../assets/js/onde/tx.js";
import { canale, casuale } from "../../assets/js/onde/canale.js";

let server, browser;
before(async () => {
  server = await servi();
  browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
});
after(async () => {
  await browser?.close();
  await server?.chiudi();
});

test("la pagina si apre senza errori e senza richieste verso altri siti", async () => {
  const { pagina, contesto, problemi } = await apri(browser, server.base, "onde/");
  assert.equal(await pagina.locator("h1").count(), 1);
  assert.match(await pagina.locator("#conta").textContent(), /15 di 120 byte · \d+ note · \d,\d secondi/);
  assert.equal(await pagina.locator("#trasmetti").isDisabled(), false);
  assert.equal(await pagina.locator('#menu a[aria-current="page"]').textContent(), "Onde");
  // lo "spartito" del messaggio è stato disegnato
  const pieni = await pagina.evaluate(() => {
    const c = document.getElementById("spartito");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  });
  assert.ok(pieni > 300, `spartito disegnato (${pieni} punti)`);
  // testo vuoto o troppo lungo: non si può trasmettere, e la pagina dice perché
  await pagina.fill("#testo", "");
  assert.equal(await pagina.locator("#trasmetti").isDisabled(), true);
  await pagina.fill("#testo", "è".repeat(61));
  assert.equal(await pagina.locator("#trasmetti").isDisabled(), true);
  assert.match(await pagina.locator("#conta").textContent(), /122 byte: troppo lungo/);
  assert.deepEqual(problemi, []);
  await contesto.close();
});

test("canale simulato: il messaggio arriva ed è marcato come simulato; con troppo rumore non arriva", async () => {
  const { pagina, contesto, problemi } = await apri(browser, server.base, "onde/");
  await pagina.fill("#testo", "Prova nel canale simulato: àèìòù");
  await pagina.click("#sim-vai");
  await pagina.waitForFunction(() => document.querySelectorAll("#messaggi li").length === 1, null, { timeout: 30000 });
  assert.equal(await pagina.locator("#messaggi li .onde-testo").textContent(), "Prova nel canale simulato: àèìòù");
  assert.equal(await pagina.locator("#messaggi li .badge.sim").textContent(), "Simulato");
  assert.match(await pagina.locator("#sim-esito").textContent(), /^Arrivato/);
  assert.equal(await pagina.locator("#sim-suona").isDisabled(), false);
  // il grafico del suono non è più vuoto
  const colori = await pagina.evaluate(() => {
    const c = document.getElementById("spettro");
    const d = c.getContext("2d").getImageData(c.width - 300, 0, 300, c.height).data;
    const visti = new Set();
    for (let i = 0; i < d.length; i += 4) visti.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    return visti.size;
  });
  assert.ok(colori > 20, `grafico disegnato (${colori} colori diversi)`);
  // rumore al massimo (12 dB più forte del segnale) e riverbero al massimo: non deve arrivare, e non deve arrivare sbagliato
  await pagina.evaluate(() => {
    for (const [id, v] of [["sim-rumore", "12"], ["sim-eco", "1"]]) {
      const e = document.getElementById(id);
      e.value = v;
      e.dispatchEvent(new Event("input"));
    }
  });
  assert.match(await pagina.locator("#sim-rumore-val").textContent(), /12 dB più forte del segnale/);
  await pagina.click("#sim-vai");
  await pagina.waitForFunction(() => /^(Non arrivato|Arrivato)/.test(document.getElementById("sim-esito").textContent), null, { timeout: 30000 });
  assert.match(await pagina.locator("#sim-esito").textContent(), /^Non arrivato/);
  assert.equal(await pagina.locator("#messaggi li").count(), 1);
  assert.deepEqual(problemi, []);
  await contesto.close();
});

test("trasmissione: il suono prodotto dalla pagina viene decodificato dal ricevitore", async () => {
  const { pagina, contesto, problemi } = await apri(browser, server.base, "onde/");
  await pagina.fill("#testo", "Dal browser al ricevitore");
  await pagina.click("#trasmetti");
  await pagina.waitForFunction(() => window.__onde.ultimaTrasmissione !== null, null, { timeout: 10000 });
  assert.equal(await pagina.locator("#trasmetti").isDisabled(), true, "durante la trasmissione il pulsante è spento");
  const decodificato = await pagina.evaluate(async () => {
    const { ricevi } = await import(new URL("../assets/js/onde/rx.js", location.href));
    const { audio, fs } = window.__onde.ultimaTrasmissione;
    let picco = 0;
    for (const v of audio) picco = Math.max(picco, Math.abs(v));
    return { testi: ricevi(audio, fs).messaggi.map((m) => m.testo), fs, picco, secondi: audio.length / fs };
  });
  assert.deepEqual(decodificato.testi, ["Dal browser al ricevitore"]);
  assert.ok(decodificato.picco <= 0.81 && decodificato.picco > 0.7);
  await pagina.waitForFunction(() => /^Trasmesso in/.test(document.getElementById("tx-stato").textContent), null, { timeout: 20000 });
  assert.equal(await pagina.locator("#trasmetti").isDisabled(), false);
  assert.deepEqual(problemi, []);
  await contesto.close();
});

test("ascolto: un file audio al posto del microfono, con rumore, e il messaggio compare", async () => {
  const fsAudio = 48000;
  const testo = "Arrivato dal microfono (finto)";
  const cartella = fs.mkdtempSync(path.join(os.tmpdir(), "polpo-onde-"));
  const wav = path.join(cartella, "microfono.wav");
  const audio = canale(trasmetti(testo, fsAudio).audio, fsAudio, { snr: 12, anticipo: 1.2, coda: 1.5, guadagno: 0.5 }, casuale(2026));
  scriviWav(wav, audio, fsAudio);
  const conMicrofono = await chromium.launch({
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`, "--autoplay-policy=no-user-gesture-required"],
  });
  try {
    const { pagina, problemi } = await apri(conMicrofono, server.base, "onde/");
    assert.match(await pagina.locator("#rx-stato").textContent(), /solo quando premi/);
    await pagina.click("#ascolta");
    await pagina.waitForFunction(() => document.getElementById("ascolta").getAttribute("aria-pressed") === "true", null, { timeout: 10000 });
    assert.match(await pagina.locator("#impostazioni").textContent(), /Microfono a \d+ Hz\. Filtri per la voce spenti\./);
    await pagina.waitForFunction(() => document.querySelectorAll("#messaggi li").length >= 1, null, { timeout: 40000 });
    assert.equal(await pagina.locator("#messaggi li .onde-testo").first().textContent(), testo);
    assert.equal(await pagina.locator("#messaggi li .badge.sim").count(), 0, "un messaggio dal microfono non è marcato come simulato");
    assert.equal(await pagina.locator("#scarica").isDisabled(), false);
    // la registrazione scaricata è un file WAV vero
    const [scaricato] = await Promise.all([pagina.waitForEvent("download"), pagina.click("#scarica")]);
    assert.equal(scaricato.suggestedFilename(), "polpo-onde-registrazione.wav");
    const dati = fs.readFileSync(await scaricato.path());
    assert.equal(dati.subarray(0, 4).toString(), "RIFF");
    assert.ok(dati.length > 44 + 2 * 44100, "almeno un secondo di audio");
    await pagina.click("#ascolta");
    assert.equal(await pagina.locator("#ascolta").getAttribute("aria-pressed"), "false");
    assert.match(await pagina.locator("#rx-stato").textContent(), /Ascolto fermo/);
    assert.deepEqual(problemi, []);
  } finally {
    await conMicrofono.close();
    fs.rmSync(cartella, { recursive: true, force: true });
  }
});

test("telefono: nessuno scorrimento orizzontale, comandi utilizzabili", async () => {
  const { pagina, contesto, problemi } = await apri(browser, server.base, "onde/", { ...devices["iPhone 13"] });
  const sfora = await pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(sfora <= 0, `la pagina sfora di ${sfora} px`);
  for (const id of ["#trasmetti", "#ascolta", "#sim-vai"]) {
    const riquadro = await pagina.locator(id).boundingBox();
    assert.ok(riquadro.height >= 40, `${id} è abbastanza grande da toccare`);
  }
  assert.deepEqual(problemi, []);
  await contesto.close();
});
