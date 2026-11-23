// Polpo Studio nell'app (pagine di site/build.py --app): con lo schermo di un telefono e il Polpo virtuale, cioè il
// firmware vero. Si eseguono solo se APP_DIR indica la cartella costruita.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, devices, servi } from "./aiuto.mjs";

const APP = process.env.APP_DIR ? path.resolve(process.env.APP_DIR) : "";
const salta = APP && fs.existsSync(path.join(APP, "studio/index.html")) && fs.existsSync(path.join(APP, "simulatore/polpo-sim.wasm"))
  ? false : "APP_DIR non indicata (o senza firmware): prove di Studio saltate";

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

async function apriStudio() {
  const contesto = await browser.newContext({ ...devices["Pixel 7"], reducedMotion: "reduce" });
  const pagina = await contesto.newPage();
  const problemi = [];
  pagina.on("console", (m) => { if (m.type() === "error") problemi.push("console: " + m.text()); });
  pagina.on("pageerror", (e) => problemi.push("errore: " + e));
  pagina.on("request", (r) => { if (!r.url().startsWith(new URL(server.base).origin)) problemi.push("richiesta esterna: " + r.url()); });
  await pagina.goto(server.base + "studio/", { waitUntil: "networkidle" });
  return { pagina, contesto, problemi };
}

const stato = (p) => p.evaluate(() => document.getElementById("st-stato").dataset.stato);

/** Avvia il Polpo virtuale e accetta il collegamento sul suo schermo, come farebbe una persona. */
async function collegaVirtuale(pagina) {
  await pagina.click("#st-collega");
  await pagina.click("#st-virtuale");
  await pagina.waitForFunction(() => document.getElementById("st-stato").dataset.stato === "attesa_conferma", null, { timeout: 30000 });
  await pagina.waitForTimeout(400);
  await pagina.click('[data-tasto="destra"]');
  await pagina.waitForTimeout(200);
  await pagina.click('[data-tasto="ok"]');
  await pagina.waitForFunction(() => document.getElementById("st-stato").dataset.stato === "collegato", null, { timeout: 10000 });
}

const statoFunzione = (p, id) => p.evaluate((x) => document.querySelector(`#st-moduli [data-funzione="${x}"]`)?.dataset.stato, id);

test("Studio: senza Polpo le funzioni dicono cosa serve, il collegamento va accettato sul Polpo virtuale", { skip: salta }, async () => {
  const { pagina, contesto, problemi } = await apriStudio();
  assert.equal(await stato(pagina), "chiuso");
  assert.equal(await statoFunzione(pagina, "polpo.info"), "richiede_hardware");
  // l'aggiornamento del firmware chiede il Polpo con il cavo; le app di terze parti (Python) ci sono solo sul PC
  assert.equal(await statoFunzione(pagina, "polpo.firmware"), "richiede_hardware");
  assert.equal(await statoFunzione(pagina, "apps.third_party"), "non_disponibile");
  assert.equal(await pagina.locator('[data-funzione="polpo.info"] fieldset[disabled]').count(), 1);
  await collegaVirtuale(pagina);
  assert.match(await pagina.textContent("#st-stato"), /Polpo virtuale \(SIMULATO\)/);
  assert.equal(await statoFunzione(pagina, "polpo.info"), "simulato");
  await pagina.click("text=Leggi le informazioni");
  await pagina.waitForSelector('[data-funzione="polpo.info"] table');
  assert.match(await pagina.textContent('[data-funzione="polpo.info"] table'), /Cardputer/);
  // la microSD: una cartella del Polpo virtuale
  await pagina.click("text=Apri la microSD");
  await pagina.waitForSelector("text=📁 script");
  // scollegare chiude anche la sessione sul Polpo
  await pagina.click("#st-scollega");
  await pagina.waitForFunction(() => document.getElementById("st-stato").dataset.stato === "chiuso", null, { timeout: 5000 });
  assert.equal(await statoFunzione(pagina, "polpo.info"), "richiede_hardware");
  assert.deepEqual(problemi, []);
  await contesto.close();
});

test("Studio: uno script copiato sul Polpo virtuale ed eseguito dopo la conferma sul suo schermo", { skip: salta }, async () => {
  const { pagina, contesto, problemi } = await apriStudio();
  await collegaVirtuale(pagina);
  await pagina.click('a[href="#script"]');
  await pagina.fill('[aria-label="Il programma"]', 'scrivi("ciao dal telefono")\nscrivi(6 * 7)\n');
  await pagina.click('#m-script button:text-is("Controlla")');
  await pagina.waitForSelector("text=Nessun errore: il programma è scritto bene (SIMULATO).");
  await pagina.click("text=Esegui sul Polpo");
  await pagina.waitForSelector("text=Chiedo di avviarlo: conferma sullo schermo del Polpo.");
  await pagina.waitForTimeout(500);
  await pagina.click('[data-tasto="destra"]');
  await pagina.waitForTimeout(200);
  await pagina.click('[data-tasto="ok"]');
  await pagina.waitForFunction(() => document.querySelector('[aria-label="Ciò che il programma scrive"]').value.includes("42"), null, { timeout: 10000 });
  assert.match(await pagina.inputValue('[aria-label="Ciò che il programma scrive"]'), /ciao dal telefono\n42/);
  // un errore nel programma: riga e spiegazione, niente esecuzione
  await pagina.fill('[aria-label="Il programma"]', "se 1 > 0\n  scrivi(1)\n");
  await pagina.click('#m-script button:text-is("Controlla")');
  await pagina.waitForSelector("text=/^Riga 1: /");
  assert.deepEqual(problemi, []);
  await contesto.close();
});

test("Studio: l'elenco di tutte le funzioni, con le escluse per scelta e le non ancora nell'app", { skip: salta }, async () => {
  const { pagina, contesto, problemi } = await apriStudio();
  await pagina.click('a[href="#funzioni"]');
  await pagina.waitForSelector('#m-funzioni [data-funzione="radio.jam"]');
  const stato1 = (id) => pagina.evaluate((x) => document.querySelector(`#m-funzioni [data-funzione="${x}"]`)?.dataset.stato, id);
  assert.equal(await stato1("radio.jam"), "non_disponibile");
  assert.equal(await stato1("nfc.emulate"), "non_disponibile");
  assert.equal(await stato1("usb.run"), "non_disponibile");
  assert.equal(await stato1("radio.rx"), "richiede_hardware");
  assert.match(await pagina.textContent('#m-funzioni [data-funzione="apps.third_party"]'), /Solo nel programma per PC/);
  const larghezza = await pagina.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(larghezza <= 1, `${larghezza} px oltre il bordo`);
  assert.deepEqual(problemi, []);
  await contesto.close();
});

test("Studio: cassaforte creata nel telefono, chiave di recupero, PIN, laboratorio e archivio", { skip: salta }, async () => {
  const { pagina, contesto, problemi } = await apriStudio();
  await pagina.click('a[href="#sicurezza"]');
  await pagina.fill('[aria-label="Frase di accesso"]', "corto");
  await pagina.fill('[aria-label="Ripeti la frase"]', "corto");
  await pagina.click("text=Crea la cassaforte >> nth=-1");
  await pagina.waitForSelector("text=/Frase troppo debole/");
  const frase = "polpo blu mangia sedici biscotti";
  await pagina.fill('[aria-label="Frase di accesso"]', frase);
  await pagina.fill('[aria-label="Ripeti la frase"]', frase);
  await pagina.click("text=Crea la cassaforte >> nth=-1");
  await pagina.waitForSelector("#st-recupero", { timeout: 30000 });
  assert.match(await pagina.textContent("#st-recupero"), /^[A-Z2-7]{4}(-[A-Z2-7]{4})+$/);
  await pagina.click("text=L'ho scritta su carta");
  await pagina.waitForSelector('#m-sicurezza h3:has-text("Modalità laboratorio")');
  // il laboratorio chiede le regole accettate e la frase (o il PIN)
  await pagina.fill('[aria-label="Nuovo PIN (da 4 a 12 cifre)"]', "2468");
  await pagina.click("text=Imposta il PIN");
  await pagina.waitForSelector("#m-sicurezza >> text=Togli il PIN");
  await pagina.fill('[aria-label="PIN o frase di accesso, per conferma"]', "2468");
  await pagina.click("button:has-text('Attiva')");
  await pagina.waitForSelector("#st-avviso >> text=Serve accettare le regole.");
  await pagina.check("text=Ho letto e accetto queste regole");
  await pagina.fill('[aria-label="PIN o frase di accesso, per conferma"]', "2468");
  await pagina.click("button:has-text('Attiva')");
  await pagina.waitForSelector("#m-sicurezza >> text=Disattiva ora");
  assert.equal(await pagina.evaluate(() => window.__studio.richiediLaboratorio("rf.tx")), true);
  // archivio: un file importato, poi bloccato con il PIN
  await pagina.click('a[href="#archivio"]');
  await pagina.setInputFiles('#m-archivio input[type="file"]', { name: "nota.txt", mimeType: "text/plain", buffer: Buffer.from("ciao") });
  await pagina.waitForSelector("#m-archivio >> text=nota.txt");
  await pagina.click('a[href="#sicurezza"]');
  await pagina.click("text=Blocca ora");
  await pagina.waitForSelector("#m-sicurezza >> text=Studio bloccato");
  assert.equal(await pagina.evaluate(() => window.__studio.richiediLaboratorio("rf.tx")), false, "bloccando si spegne il laboratorio");
  await pagina.fill('[aria-label="PIN"]', "2468");
  await pagina.click("text=Sblocca");
  await pagina.waitForSelector("#m-sicurezza >> text=Imposta il PIN");
  assert.deepEqual(problemi, []);
  await contesto.close();
});

/** Cassaforte nuova e aperta (serve per salvare codici e telecomandi). */
async function creaCassaforte(pagina, frase = "polpo blu mangia sedici biscotti") {
  await pagina.click('a[href="#sicurezza"]');
  await pagina.fill('[aria-label="Frase di accesso"]', frase);
  await pagina.fill('[aria-label="Ripeti la frase"]', frase);
  await pagina.click("text=Crea la cassaforte >> nth=-1");
  await pagina.waitForSelector("#st-recupero", { timeout: 30000 });
  await pagina.click("text=L'ho scritta su carta");
  await pagina.waitForSelector('#m-sicurezza h3:has-text("Modalità laboratorio")');
}

async function confermaSulPolpo(pagina) {
  await pagina.waitForTimeout(500);
  await pagina.click('[data-tasto="destra"]');
  await pagina.waitForTimeout(200);
  await pagina.click('[data-tasto="ok"]');
}

test("Studio: infrarossi dalla libreria e un tasto imparato dal telecomando simulato", { skip: salta }, async () => {
  const { pagina, contesto, problemi } = await apriStudio();
  await creaCassaforte(pagina);
  await collegaVirtuale(pagina);
  await pagina.click('a[href="#infrarossi"]');
  await pagina.click('#m-infrarossi button:has-text("Apri") >> nth=0');
  await pagina.locator("#m-infrarossi .st-telecomando button").first().click();
  await pagina.waitForSelector("#st-avviso >> text=/^Inviato «.*»\\. · SIMULATO/");
  // apprendimento: la IR Unit sulla porta Grove del Polpo virtuale, poi un tasto del telecomando simulato
  await pagina.click("summary:has-text('Il mondo simulato')");
  await pagina.locator("#st-grove").selectOption("ir");
  await pagina.click("text=Impara un tasto…");
  await pagina.waitForSelector("#st-avviso >> text=/In ascolto/");
  await pagina.click("[data-ir]");
  await pagina.waitForSelector("#st-avviso >> text=/^Imparato «tasto 1»/", { timeout: 10000 });
  assert.match(await pagina.textContent('#m-infrarossi [aria-label="I miei telecomandi"]'), /telecomando imparato\.ir · SIMULATO/);
  assert.deepEqual(problemi, []);
  await contesto.close();
});

test("Studio: un codice a 433 MHz ricevuto, salvato e trasmesso con laboratorio e conferma sul Polpo", { skip: salta }, async () => {
  const { pagina, contesto, problemi } = await apriStudio();
  pagina.on("dialog", (d) => (d.type() === "prompt" ? d.accept("presa salotto") : d.accept()));
  await creaCassaforte(pagina);
  await collegaVirtuale(pagina);
  await pagina.click("summary:has-text('Il mondo simulato')");
  await pagina.locator("#st-grove").selectOption("rf433");
  await pagina.click('a[href="#radio"]');
  await pagina.click("text=Avvia ascolto");
  await pagina.click('[data-rf="5592405"]');
  await pagina.waitForSelector('#m-radio [aria-label="Codici ricevuti"] >> text=0x555555');
  await pagina.click('#m-radio button:has-text("Salva…")');
  await pagina.waitForSelector("#m-radio >> text=presa salotto.sub");
  await pagina.check('#m-radio input[name="st-radio-voce"]');
  // senza laboratorio non parte
  await pagina.click("text=Trasmetti il codice selezionato…");
  await pagina.waitForSelector("#st-avviso >> text=/modalità laboratorio/i");
  await pagina.click('a[href="#sicurezza"]');
  await pagina.check("text=Ho letto e accetto queste regole");
  await pagina.fill('[aria-label="PIN o frase di accesso, per conferma"]', "polpo blu mangia sedici biscotti");
  await pagina.click("button:has-text('Attiva')");
  await pagina.waitForSelector("#m-sicurezza >> text=Disattiva ora", { timeout: 20000 });
  await pagina.click('a[href="#radio"]');
  await pagina.check('#m-radio input[name="st-radio-voce"]');
  await pagina.click("text=Trasmetti il codice selezionato…");
  await pagina.waitForSelector("#st-avviso >> text=/attendo la conferma sul suo schermo/");
  await confermaSulPolpo(pagina);
  await pagina.waitForSelector("#st-avviso >> text=/^Trasmesso\\. Tempo radio usato/", { timeout: 15000 });
  assert.match(await pagina.textContent("#st-avviso"), /SIMULATO/);
  assert.deepEqual(problemi, []);
  await contesto.close();
});

test("Studio: un tag NFC simulato letto, analizzato, salvato e scritto con laboratorio e conferma sul Polpo", { skip: salta }, async () => {
  const { pagina, contesto, problemi } = await apriStudio();
  pagina.on("dialog", (d) => d.accept());
  await creaCassaforte(pagina);
  await collegaVirtuale(pagina);
  await pagina.click("summary:has-text('Il mondo simulato')");
  await pagina.locator("#st-grove").selectOption("rfid2");
  await pagina.locator("#st-tag").selectOption("ntag213");
  await pagina.click('a[href="#nfc"]');
  await pagina.click("text=Leggi dal Polpo");
  await pagina.waitForSelector("#m-nfc .st-nfc >> text=NTAG213");
  assert.match(await pagina.textContent("#m-nfc .st-nfc"), /SIMULATO: tag inventato dal Polpo virtuale/);
  await pagina.click("text=Salva la lettura");
  await pagina.waitForSelector("#m-nfc >> text=/^tag-.*\\.json$/");
  // analizzatore NDEF: il messaggio d'esempio
  await pagina.fill('[aria-label="Byte in esadecimale"]', "03 11 D1 01 0D 55 04 65 78 61 6D 70 6C 65 2E 6F 72 67 FE");
  await pagina.click("#m-nfc button:has-text('Analizza')");
  await pagina.waitForSelector("#m-nfc >> text=/example\\.org/");
  // scrittura: laboratorio, poi conferma sul Polpo
  await pagina.click('a[href="#sicurezza"]');
  await pagina.check("text=Ho letto e accetto queste regole");
  await pagina.fill('[aria-label="PIN o frase di accesso, per conferma"]', "polpo blu mangia sedici biscotti");
  await pagina.click("button:has-text('Attiva')");
  await pagina.waitForSelector("#m-sicurezza >> text=Disattiva ora", { timeout: 20000 });
  await pagina.click('a[href="#nfc"]');
  await pagina.locator('[aria-label="Tipo"]').selectOption("text");
  await pagina.fill('[aria-label="Contenuto"]', "ciao dal telefono");
  await pagina.click("text=Scrivi sul tag…");
  await pagina.waitForSelector("#st-avviso >> text=/Conferma sullo schermo del Polpo/");
  await confermaSulPolpo(pagina);
  await pagina.waitForSelector("#st-avviso >> text=/^Scritto e verificato/", { timeout: 20000 });
  await pagina.click("text=Leggi dal Polpo");
  await pagina.waitForSelector("#m-nfc .st-nfc >> text=ciao dal telefono");
  assert.deepEqual(problemi, []);
  await contesto.close();
});
