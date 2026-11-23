// Polpo Studio nell'app con il telefono da solo (versione 0.5): NFC, infrarossi e Bluetooth del telefono, console
// seriale, Polpo Bridge e iButton via cavo OTG, aggiornamento del firmware. Il telefono è il finto PolpoNativo di
// nativo_finto.mjs, con le regole dell'app vera. Si eseguono solo se APP_DIR indica la cartella costruita.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, devices, servi } from "./aiuto.mjs";
import { nativoFinto, USB_ESEMPI } from "./nativo_finto.mjs";

const APP = process.env.APP_DIR ? path.resolve(process.env.APP_DIR) : "";
const salta = APP && fs.existsSync(path.join(APP, "studio/index.html")) ? false : "APP_DIR non indicata: prove del telefono saltate";

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

async function apriStudio(opzioni = {}) {
  const contesto = await browser.newContext({ ...devices["Pixel 7"], reducedMotion: "reduce" });
  await contesto.addInitScript(nativoFinto, { radice: server.base, ...opzioni });
  const pagina = await contesto.newPage();
  const problemi = [];
  pagina.on("console", (m) => { if (m.type() === "error") problemi.push("console: " + m.text()); });
  pagina.on("pageerror", (e) => problemi.push("errore: " + e));
  pagina.on("request", (r) => { if (!r.url().startsWith(new URL(server.base).origin)) problemi.push("richiesta esterna: " + r.url()); });
  pagina.on("dialog", (d) => d.accept());
  await pagina.goto(server.base + "studio/", { waitUntil: "networkidle" });
  return { pagina, contesto, problemi };
}

const statoFunzione = (p, id) => p.evaluate((x) => document.querySelector(`#st-moduli [data-funzione="${x}"]`)?.dataset.stato, id);
const finto = (p, fn) => p.evaluate(fn);
const avviso = (p, re, timeout = 10000) => p.waitForSelector(`#st-avviso >> text=${re}`, { timeout });

async function creaCassaforte(pagina, frase = "polpo blu mangia sedici biscotti") {
  await pagina.click('a[href="#sicurezza"]');
  await pagina.fill('[aria-label="Frase di accesso"]', frase);
  await pagina.fill('[aria-label="Ripeti la frase"]', frase);
  await pagina.click("text=Crea la cassaforte >> nth=-1");
  await pagina.waitForSelector("#st-recupero", { timeout: 30000 });
  await pagina.click("text=L'ho scritta su carta");
  await pagina.waitForSelector('#m-sicurezza h3:has-text("Modalità laboratorio")');
}

async function attivaLaboratorio(pagina, frase = "polpo blu mangia sedici biscotti") {
  await pagina.click('a[href="#sicurezza"]');
  await pagina.check("text=Ho letto e accetto queste regole");
  await pagina.fill('[aria-label="PIN o frase di accesso, per conferma"]', frase);
  await pagina.click("button:has-text('Attiva')");
  await pagina.waitForSelector("#m-sicurezza >> text=Disattiva ora", { timeout: 20000 });
}

test("Telefono: senza Polpo, NFC, infrarossi e Bluetooth del telefono rendono disponibili le loro funzioni", { skip: salta }, async () => {
  const { pagina, contesto, problemi } = await apriStudio();
  assert.equal(await statoFunzione(pagina, "nfc.read"), "disponibile");
  assert.equal(await statoFunzione(pagina, "ir.send"), "disponibile");
  assert.equal(await statoFunzione(pagina, "ble.scan"), "disponibile");
  assert.equal(await statoFunzione(pagina, "ble.gatt"), "disponibile");
  // la radio a 433 MHz il telefono non ce l'ha: resta legata al Polpo
  assert.equal(await statoFunzione(pagina, "radio.rx"), "richiede_hardware");
  // un telefono senza emettitore: l'invio IR torna a chiedere il Polpo
  const senza = await apriStudio({ ir: false, nfc: "assente" });
  assert.equal(await statoFunzione(senza.pagina, "ir.send"), "richiede_hardware");
  assert.equal(await statoFunzione(senza.pagina, "nfc.read"), "richiede_hardware");
  await senza.contesto.close();
  assert.deepEqual(problemi, []);
  await contesto.close();
});

test("Telefono: un tag letto con l'NFC del telefono e scritto con laboratorio e conferma", { skip: salta }, async () => {
  const { pagina, contesto, problemi } = await apriStudio();
  await creaCassaforte(pagina);
  await pagina.click('a[href="#nfc"]');
  await pagina.click("text=Leggi con il telefono");
  await pagina.waitForSelector("#m-nfc .st-nfc >> text=NTAG213");
  assert.match(await pagina.textContent("#m-nfc .st-nfc"), /Ciao dal Polpo/);
  await avviso(pagina, "/NFC del telefono/");
  // senza laboratorio la scrittura non parte
  await pagina.locator('[aria-label="Tipo"]').selectOption("text");
  await pagina.fill('[aria-label="Contenuto"]', "ciao dal telefono");
  await pagina.click("text=Scrivi con il telefono…");
  await avviso(pagina, "/modalità laboratorio/i");
  assert.equal((await finto(pagina, () => window.__nativoFinto.chiamate.filter((c) => c[0] === "nfcScrivi"))).length, 0);
  await attivaLaboratorio(pagina);
  await pagina.click('a[href="#nfc"]');
  await pagina.click("text=Scrivi con il telefono…");
  await avviso(pagina, "/NFC del telefono/", 15000);
  await pagina.click("text=Leggi con il telefono");
  await pagina.waitForSelector("#m-nfc .st-nfc >> text=ciao dal telefono");
  assert.deepEqual(problemi, []);
  await contesto.close();
});

test("Telefono: un tasto della libreria inviato con l'emettitore infrarossi del telefono", { skip: salta }, async () => {
  const { pagina, contesto, problemi } = await apriStudio();
  await pagina.click('a[href="#infrarossi"]');
  assert.equal(await pagina.locator('#m-infrarossi [aria-label="Invia con"]').inputValue(), "telefono");
  await pagina.click('#m-infrarossi button:has-text("Apri") >> nth=0');
  await pagina.locator("#m-infrarossi .st-telecomando button").first().click();
  await avviso(pagina, "/^Inviato «.*» con il telefono\\./");
  const ir = await finto(pagina, () => window.__nativoFinto.ir);
  assert.equal(ir.length, 1);
  assert.ok(ir[0].frequenza >= 20000 && ir[0].frequenza <= 60000);
  assert.ok(ir[0].tempi.length > 10 && ir[0].tempi.length <= 1024);
  assert.deepEqual(problemi, []);
  await contesto.close();
});

test("Telefono: Bluetooth, ricerca, un dispositivo autorizzato, collegamento e lettura della batteria", { skip: salta }, async () => {
  const { pagina, contesto, problemi } = await apriStudio({ durataRicercaMs: 200 });
  await creaCassaforte(pagina);
  await pagina.click('a[href="#bluetooth"]');
  await pagina.click("text=Cerca con il telefono");
  await avviso(pagina, "/^2 dispositivi vicini/");
  assert.match(await pagina.textContent("#m-bluetooth table"), /Cuffie di Marta/);
  // non autorizzato: il collegamento non parte
  await pagina.locator('#m-bluetooth [aria-label="Dispositivo"]').selectOption({ label: "Cuffie di Marta · 6A:14:9F:20:3B:11" });
  await pagina.click("#m-bluetooth button:text-is('Collega')");
  await avviso(pagina, "/autorizza il dispositivo/i");
  await pagina.click("text=Autorizza (è mio)…");
  await avviso(pagina, "/^Autorizzato/");
  assert.match(await pagina.textContent('#m-bluetooth [data-funzione="ble.authorized"]'), /6A:14:9F:20:3B:11/);
  await pagina.click("#m-bluetooth button:text-is('Collega')");
  await avviso(pagina, "/servizi/");
  await pagina.click("#m-bluetooth input[type=radio] >> nth=0");
  await pagina.click("#m-bluetooth button:text-is('Leggi')");
  await pagina.waitForSelector("#m-bluetooth pre >> text=/2a19.*: 57/");
  await pagina.click("#m-bluetooth button:text-is('Scollega')");
  await pagina.waitForSelector("#m-bluetooth pre >> text=Scollegato");
  // niente scritture Bluetooth, mai
  assert.equal((await finto(pagina, () => window.__nativoFinto.chiamate.filter((c) => /scriv/i.test(c[0]) && c[0].startsWith("ble")))).length, 0);
  assert.deepEqual(problemi, []);
  await contesto.close();
});

test("Telefono: console seriale su un adattatore CH340, mai a 1200 baud", { skip: salta }, async () => {
  const { pagina, contesto, problemi } = await apriStudio({ usb: [USB_ESEMPI.ch340] });
  await pagina.click('a[href="#gpio"]');
  assert.equal(await statoFunzione(pagina, "gpio.console"), "disponibile");
  assert.match(await pagina.textContent('[data-funzione="gpio.boards"]'), /CH340/);
  const scheda = pagina.locator('[data-funzione="gpio.console"]');
  await scheda.locator('[aria-label="Velocità"]').selectOption("9600");
  await scheda.locator("button:text-is('Apri')").click();
  await avviso(pagina, "/^Console aperta su .* a 9600 baud/");
  const aperta = await finto(pagina, () => window.__nativoFinto.seriale.aperta);
  assert.equal(aperta.baud, 9600);
  await finto(pagina, () => window.__nativoFinto.datiSeriale("pronto\r\n"));
  await pagina.waitForSelector('[data-funzione="gpio.console"] pre >> text=pronto');
  await scheda.locator('[aria-label="Testo da inviare"]').fill("stato");
  await scheda.locator("button:text-is('Invia')").click();
  await pagina.waitForFunction(() => window.__nativoFinto.seriale.testo() === "stato\n");
  await scheda.locator("button:text-is('Chiudi')").click();
  await avviso(pagina, "/Console chiusa/");
  assert.ok(!(await finto(pagina, () => window.__nativoFinto.seriale.baud)).includes(1200));
  assert.ok(!(await pagina.locator('[data-funzione="gpio.console"] [aria-label="Velocità"] option[value="1200"]').count()));
  assert.deepEqual(problemi, []);
  await contesto.close();
});

test("Telefono: Polpo Bridge via cavo, pin letto, uscita solo con laboratorio, chiave iButton", { skip: salta }, async () => {
  const { pagina, contesto, problemi } = await apriStudio({ usb: [USB_ESEMPI.ch340] });
  // la scheda con lo sketch Polpo Bridge: risponde alle righe JSON come studio/bridge/polpo_bridge
  await pagina.evaluate(() => {
    const f = window.__nativoFinto;
    let resto = "";
    f.suScrittura = (dati) => {
      resto += new TextDecoder().decode(dati);
      let i;
      while ((i = resto.indexOf("\n")) >= 0) {
        const riga = resto.slice(0, i);
        resto = resto.slice(i + 1);
        const r = JSON.parse(riga);
        const dati = {
          hello: { bridge: "Polpo Bridge", version: "1.0", proto: 1, board: "Arduino Uno", pins: [2, 3, 4], adc: [14], onewire_pin: 8 },
          "pin.read": { pin: r.args && r.args.pin, value: 1 },
          "pin.mode": { pin: r.args && r.args.pin, mode: r.args && r.args.mode },
          "ow.search": { roms: [{ rom: "01 23 45 67 89 AB CD 28" }] },
        }[r.cmd];
        const risposta = dati ? { id: r.id, ok: true, data: dati } : { id: r.id, ok: false, error: { code: "bad_cmd", msg: "comando sconosciuto" } };
        setTimeout(() => f.datiSeriale(JSON.stringify(risposta) + "\n"), 10);
      }
    };
  });
  await pagina.click('a[href="#gpio"]');
  const b = pagina.locator('[data-funzione="gpio.bridge"]');
  // prima del collegamento la scheda dei pin aspetta il Bridge; il pannello di collegamento è a parte
  assert.equal(await statoFunzione(pagina, "gpio.bridge"), "richiede_hardware");
  const pannello = pagina.locator('[data-pannello="bridge"]');
  await pannello.locator("button:text-is('Collega')").click();
  await avviso(pagina, "/^Polpo Bridge collegato/");
  assert.match(await pannello.textContent(), /Collegato: Arduino Uno, versione 1\.0/);
  assert.equal(await statoFunzione(pagina, "gpio.bridge"), "sperimentale");
  await b.locator("button:text-is('Leggi')").click();
  await pagina.waitForSelector('[data-funzione="gpio.bridge"] pre >> text=/pin 2 = 1/');
  // un pin come uscita: serve la modalità laboratorio
  await b.locator('[aria-label="Modo del pin"]').selectOption("output");
  await b.locator("button:text-is('Imposta modo')").click();
  await avviso(pagina, "/modalità laboratorio/i");
  // iButton: il codice ROM con famiglia e CRC8
  await pagina.click('a[href="#ibutton"]');
  await pagina.click("text=Cerca chiavi");
  await pagina.waitForSelector("#m-ibutton table >> text=01 23 45 67 89 AB CD 28");
  assert.match(await pagina.textContent("#m-ibutton table"), /DS1990/);
  // nessuna scrittura né emulazione di chiavi: il comando non esiste nemmeno
  assert.ok(!(await finto(pagina, () => window.__nativoFinto.seriale.testo())).match(/ow\.write|emul/));
  assert.deepEqual(problemi, []);
  await contesto.close();
});

test("Telefono: il firmware incluso nell'app ha l'impronta giusta e l'aggiornamento chiede il laboratorio", { skip: salta }, async () => {
  const { pagina, contesto, problemi } = await apriStudio({ usb: [USB_ESEMPI.polpo] });
  await pagina.click('a[href="#polpo"]');
  assert.equal(await statoFunzione(pagina, "polpo.firmware"), "sperimentale");
  const s = pagina.locator('[data-funzione="polpo.firmware"]');
  await s.locator("text=Controlla il firmware incluso").click();
  await pagina.waitForSelector('[data-funzione="polpo.firmware"] >> text=/impronta SHA-256 verificata/', { timeout: 20000 });
  await s.locator("button:has-text('Aggiorna il Polpo')").click();
  await avviso(pagina, "/modalità laboratorio/i");
  assert.equal((await finto(pagina, () => window.__nativoFinto.seriale.tocchi)).length, 0, "senza laboratorio nessun tocco a 1200 baud");
  assert.deepEqual(problemi, []);
  await contesto.close();
});
