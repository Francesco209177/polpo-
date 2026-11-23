// L'aggiornamento del firmware dal telefono (aggiornamento/firmware.js) contro un ponte PolpoNativo finto e un
// ESP32-S3 finto che parla il protocollo vero di esptool (esp32s3_finto.mjs): esptool-js fa davvero tutto il lavoro,
// dalla sincronizzazione con la ROM allo stub, alla scrittura compressa, all'MD5, al reset.
import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import {
  aggiorna,
  firmwareIncluso,
  controllaImmagine,
  verificaImmagine,
  leggiIndirizzo,
  trovaPolpo,
  ErroreAggiornamento,
  INDIRIZZO_APP,
  DIMENSIONE_PARTIZIONE_APP,
} from "../../../assets/js/studio/aggiornamento/firmware.js";
import { NativoUsbFinto } from "./nativo_usb_finto.mjs";
import { REG } from "./esp32s3_finto.mjs";
import { FIRMWARE } from "./firmware_dati_esempio.mjs";
import { STUB_S3, TEMPI_PROVA, immagineProva, firmwareDi, applicazioneVera, osservatore, chiamate, calma, sha256 } from "./aiuto.mjs";

const FINE_APP0 = INDIRIZZO_APP + DIMENSIONE_PARTIZIONE_APP; // 0x340000

/** Un aggiornamento completo; restituisce {nativo, oss, risultato | errore, secondi}. */
async function prova({ dati = immagineProva(), firmware = null, nativo = null, opzioni = {}, ...o } = {}) {
  nativo ||= new NativoUsbFinto({ chipRom: { stubAtteso: STUB_S3, ...(o.chipRom || {}) }, ...o });
  const oss = osservatore();
  const t0 = performance.now();
  let risultato = null, errore = null;
  try {
    risultato = await aggiorna({ nativo, firmware: firmware || firmwareDi(dati), dati, avanzamento: oss.avanzamento, log: oss.log, tempi: TEMPI_PROVA, ...opzioni });
  } catch (e) {
    errore = e;
  }
  const secondi = (performance.now() - t0) / 1000;
  await calma(150); // gli ultimi eventi del ponte finto
  return { nativo, esp: nativo.esp, oss, risultato, errore, secondi, dati };
}

/** Nulla è cambiato nella flash. */
function flashIntatta(esp) {
  assert.equal(esp.cancellati.length, 0, "niente di cancellato");
  assert.equal(esp.scritti.length, 0, "niente di scritto");
  assert.ok(Buffer.from(esp.flash).equals(Buffer.from(esp.flashIniziale)), "flash identica a prima");
  assert.ok(!esp.comandi.some((c) => [0x02, 0x03, 0x10, 0x11, 0xd0, 0xd1].includes(c.op)), "nessun comando di scrittura");
}

/** La flash contiene `dati` a 0x10000 e il resto è come prima (o cancellato, solo dentro app0). */
function soloApplicazione(esp, dati) {
  const fine = INDIRIZZO_APP + dati.length;
  assert.ok(Buffer.from(esp.flash.subarray(INDIRIZZO_APP, fine)).equals(Buffer.from(dati)), "l'applicazione è a 0x10000");
  assert.ok(Buffer.from(esp.flash.subarray(0, INDIRIZZO_APP)).equals(Buffer.from(esp.flashIniziale.subarray(0, INDIRIZZO_APP))), "bootloader, partizioni e impostazioni (0x0-0x10000) intatti");
  assert.ok(Buffer.from(esp.flash.subarray(FINE_APP0)).equals(Buffer.from(esp.flashIniziale.subarray(FINE_APP0))), "da 0x340000 in poi intatto");
  for (let i = fine; i < FINE_APP0; i++) {
    if (esp.flash[i] !== esp.flashIniziale[i] && esp.flash[i] !== 0xff) assert.fail(`byte cambiato fuori dall'applicazione: ${i.toString(16)}`);
  }
  for (const [i, f] of [...esp.cancellati, ...esp.scritti]) {
    assert.ok(i >= INDIRIZZO_APP && f <= FINE_APP0, `zona toccata fuori da app0: ${i.toString(16)}-${f.toString(16)}`);
  }
  assert.ok(!esp.comandi.some((c) => c.op === 0xd0 || c.op === 0xd1), "mai ERASE_FLASH né ERASE_REGION");
}

describe("aggiornamento completo con l'applicazione vera (2,2 MB)", () => {
  const vera = applicazioneVera(FIRMWARE);
  let r;
  before(async () => {
    if (vera) r = await prova({ dati: vera, firmware: FIRMWARE });
  });

  test("riesce: scrive solo l'applicazione a 0x10000, verifica l'MD5 e fa ripartire il Polpo", { skip: !vera && "manca polpo/release/" + FIRMWARE.app_file }, (t) => {
    assert.equal(r.errore, null, r.errore && `${r.errore.message}\n${r.oss.testo()}`);
    const scrittura = r.oss.righe.find((x) => /^Wrote /.test(x.riga));
    t.diagnostic(`2,2 MB (${vera.length} byte) contro il finto: ${r.secondi.toFixed(2)} s in tutto; esptool-js: «${scrittura && scrittura.riga}»`);
    soloApplicazione(r.esp, vera);
    assert.equal(r.risultato.versione, FIRMWARE.version);
    assert.equal(r.risultato.byte, vera.length);
    assert.equal(r.risultato.chip, "ESP32-S3 (QFN56) (revision v0.2)");
    assert.equal(r.risultato.mac, "34:85:18:12:34:56");
    assert.equal(r.risultato.flash, "8MB");
    assert.equal(r.risultato.ripartito, true);
    // lo stub arrivato è quello di esptool-js (il finto lo confronta byte per byte), poi i dati compressi e l'MD5
    assert.ok(r.esp.stubCaricato);
    const ops = r.esp.comandi.map((c) => c.op);
    assert.ok(ops.includes(0x10) && ops.includes(0x11) && ops.includes(0x12) && ops.includes(0x13), "FLASH_DEFL_BEGIN/DATA/END e SPI_FLASH_MD5");
    assert.ok(!ops.includes(0x02) && !ops.includes(0x03), "solo scrittura compressa");
    assert.ok(r.oss.righe.some((x) => x.livello === "esptool" && /Hash of data verified/.test(x.riga)));
    assert.deepEqual(r.esp.fuoriMappa, [], "nessun registro fuori dalla mappa dell'ESP32-S3");
  });

  test("avanzamento: sempre in avanti, per fasi, fino a 100", { skip: !vera }, () => {
    const p = r.oss.passi.map((x) => x.percento);
    for (let i = 1; i < p.length; i++) assert.ok(p[i] >= p[i - 1], `l'avanzamento torna indietro: ${p[i - 1]} → ${p[i]}`);
    assert.equal(p.at(-1), 100);
    const fasi = [...new Set(r.oss.passi.map((x) => x.fase))];
    assert.deepEqual(fasi, ["controllo", "bootloader", "collegamento", "preparazione", "scrittura", "verifica", "riavvio"]);
    const ultimaScrittura = r.oss.passi.filter((x) => x.fase === "scrittura").at(-1);
    assert.equal(ultimaScrittura.scritti, ultimaScrittura.totale);
  });

  test("USB: tocco a 1200 baud sul Polpo, la ROM aperta senza reset prima, reset completo dopo la scrittura", { skip: !vera }, () => {
    const c = chiamate(r.nativo);
    const nomi = c.map((x) => x.chiamata);
    const iTocco = nomi.indexOf("serialeToccoBootloader");
    assert.ok(iTocco >= 0);
    assert.equal(c[iTocco].id, "/dev/bus/usb/001/002", "il tocco va al Polpo col firmware");
    assert.ok(nomi.indexOf("serialeChiudi") < iTocco, "prima chiude un'eventuale porta aperta (una per volta)");
    const aperture = chiamate(r.nativo, "serialeApri");
    assert.equal(aperture.length, 1);
    assert.equal(aperture[0].id, "/dev/bus/usb/001/003", "apre il dispositivo nuovo (la ROM)");
    assert.deepEqual(aperture[0].opzioni, { baud: 115200, dtr: false, rts: false });
    assert.ok(!r.nativo.registro.some((x) => x.opzioni?.baud === 1200 || x.baud === 1200), "mai 1200 baud su una porta aperta");
    assert.deepEqual(chiamate(r.nativo, "serialeBaud"), [], "nessun cambio di velocità");
    // nessun cambio delle linee finché la scrittura non è finita e verificata («no reset» prima)
    const iMd5 = r.nativo.registro.findIndex((x) => x.comando === 0x13);
    const iLinee = r.nativo.registro.findIndex((x) => x.chiamata === "serialeLinee");
    assert.ok(iMd5 > 0 && iLinee > iMd5, "le linee cambiano solo dopo l'MD5");
    // il reset: RTS alto con DTR basso (EN basso), poi tutte e due basse
    const linee = chiamate(r.nativo, "serialeLinee").map((x) => [x.dtr, x.rts]);
    assert.deepEqual(linee[0], [false, true]);
    assert.deepEqual(linee.at(-1), [false, false]);
    assert.ok(!linee.some(([d, s]) => d && !s), "mai DTR alto con RTS basso (chiederebbe il bootloader)");
    assert.deepEqual(r.esp.riavvii, ["rom", "app"], "nel bootloader col tocco, poi l'applicazione");
  });

  test("come esptool.py: watchdog fermati prima dello stub, FORCE_DOWNLOAD_BOOT tolto prima del reset", { skip: !vera }, () => {
    const w = r.esp.scrittureRegistri;
    const i = (pred) => w.findIndex(pred);
    const iWdt = i((x) => x.indirizzo === REG.RTC_WDTCONFIG0 && x.valore === 0);
    assert.ok(iWdt > 0 && w[iWdt - 1].indirizzo === REG.RTC_WDTWPROTECT && w[iWdt - 1].valore === 0x50d83aa1, "WDT RTC spento con la chiave");
    assert.equal(w[iWdt].modo, "rom", "prima di caricare lo stub");
    assert.equal(r.esp.reg(REG.RTC_WDTCONFIG0), 0);
    assert.ok(r.esp.reg(REG.RTC_SWD_CONF) & 0x80000000, "super watchdog che si nutre da solo");
    const iOpt = i((x) => x.indirizzo === REG.RTC_OPTION1);
    assert.ok(iOpt > 0 && w[iOpt].maschera === 1 && w[iOpt].valore === 0);
    assert.equal(r.esp.reg(REG.RTC_OPTION1) & 1, 0);
  });
});

test("impronta sbagliata: rifiutato prima di qualsiasi azione sull'USB", async () => {
  const dati = immagineProva();
  const { errore, nativo } = await prova({ dati, firmware: firmwareDi(dati, { sha256: "0".repeat(64) }) });
  assert.ok(errore instanceof ErroreAggiornamento);
  assert.equal(errore.codice, "impronta");
  assert.match(errore.message, /impronta SHA-256/);
  assert.equal(nativo.chiamateElenco, 0, "nemmeno usbElenco");
  assert.deepEqual(nativo.registro, []);
  flashIntatta(nativo.esp);
});

test("indirizzo diverso da 0x10000, immagine completa, troppo grande o non per ESP32-S3: rifiutati prima dell'USB", async () => {
  const dati = immagineProva();
  for (const app_offset of ["0x0", "0x1000", "0x20000", "", "dieci"]) {
    const { errore, nativo } = await prova({ dati, firmware: firmwareDi(dati, { app_offset }) });
    assert.equal(errore?.codice, "indirizzo", app_offset);
    assert.equal(nativo.chiamateElenco, 0);
  }
  const completa = immagineProva(0x9000);
  completa.set([0xaa, 0x50], 0x8000); // la tabella delle partizioni a 0x8000: è l'immagine da scrivere a 0x0
  const grande = immagineProva(DIMENSIONE_PARTIZIONE_APP + 4);
  const altroChip = immagineProva();
  altroChip[12] = 5;
  for (const [img, attesa] of [[completa, /immagine completa/], [grande, /non entra nella partizione/], [altroChip, /non è per l'ESP32-S3/], [new Uint8Array(0), /vuoto/]]) {
    const { errore, nativo } = await prova({ dati: img });
    assert.equal(errore?.codice, "immagine");
    assert.match(errore.message, attesa);
    assert.equal(nativo.chiamateElenco, 0);
  }
  assert.equal(controllaImmagine(immagineProva(DIMENSIONE_PARTIZIONE_APP)), "", "esattamente la partizione va bene");
});

test("chip diverso dall'ESP32-S3 (ESP32-C3): si ferma senza caricare lo stub né scrivere", async () => {
  const { errore, esp, nativo } = await prova({ chipRom: { chip: "ESP32-C3" } });
  assert.equal(errore?.codice, "chip");
  assert.match(errore.message, /ESP32-C3, non l'ESP32-S3/);
  assert.equal(errore.scritto, false);
  flashIntatta(esp);
  assert.ok(!esp.comandi.some((c) => c.op === 0x05), "nessuno stub caricato");
  assert.deepEqual(chiamate(nativo, "serialeLinee"), [], "e nessun reset: un chip che non conosciamo non si tocca");
});

test("ESP32 classico (senza GET_SECURITY_INFO, riconosciuto dal registro magico): si ferma senza scrivere", async () => {
  const { errore, esp, nativo } = await prova({ chipRom: { chip: "ESP32" } });
  assert.equal(errore?.codice, "chip", errore?.message);
  assert.match(errore.message, /ESP32, non l'ESP32-S3/);
  flashIntatta(esp);
  assert.equal(chiamate(nativo, "serialeApri").length, 2, "esptool-js riapre la porta per riprovare col registro magico");
});

test("il Polpo non ricompare dopo il tocco: errore chiaro, nessuna porta aperta", async () => {
  const { errore, nativo, secondi } = await prova({ dopoTocco: "sparisce", opzioni: { tempi: { ...TEMPI_PROVA, ricomparsa: 400 } } });
  assert.equal(errore?.codice, "non-ricomparso");
  assert.match(errore.message, /non è ricomparso nel bootloader entro/);
  assert.ok(secondi < 2);
  assert.deepEqual(chiamate(nativo, "serialeApri"), []);
});

test("il Polpo era già nel bootloader: dopo metà dell'attesa si usa lo stesso dispositivo (come Polpo Studio)", async () => {
  const dati = immagineProva(60_000);
  const { errore, esp, nativo, risultato } = await prova({ dati, inizio: "rom", opzioni: { tempi: { ...TEMPI_PROVA, ricomparsa: 600 } } });
  assert.equal(errore, null, errore?.message);
  assert.equal(chiamate(nativo, "serialeApri")[0].id, "/dev/bus/usb/001/002");
  soloApplicazione(esp, dati);
  assert.equal(risultato.ripartito, true);
});

test("il tocco non fa ripartire il Polpo: la porta di prima non risponde al protocollo, errore di sincronizzazione", async () => {
  const { errore, esp } = await prova({ dopoTocco: "niente", opzioni: { tempi: { ...TEMPI_PROVA, ricomparsa: 300 } } });
  assert.equal(errore?.codice, "sincronizzazione", errore?.message);
  assert.match(errore.message, /bootloader non risponde/);
  flashIntatta(esp);
});

test("tocco rifiutato dal telefono, nessun Polpo, più dispositivi Espressif", async () => {
  let r = await prova({ toccoRifiutato: true });
  assert.equal(r.errore?.codice, "tocco");
  assert.match(r.errore.message, /Permesso USB negato/);
  const nessuno = new NativoUsbFinto();
  nessuno.dispositivi = [{ id: "x", nome: "Chiavetta", vid: 0x0781, pid: 0x5581, seriale: false, polpo: false }];
  r = await prova({ nativo: nessuno });
  assert.equal(r.errore?.codice, "nessun-polpo");
  const due = new NativoUsbFinto({ altri: [{ id: "/dev/bus/usb/002/009", nome: "ESP32-C3", vid: 0x303a, pid: 0x1001, seriale: true, polpo: true }] });
  r = await prova({ nativo: due });
  assert.equal(r.errore?.codice, "piu-polpo");
  assert.deepEqual(chiamate(due, "serialeToccoBootloader"), []);
  // con l'id scelto dalla pagina invece va
  r = await prova({ nativo: new NativoUsbFinto({ chipRom: { stubAtteso: STUB_S3 }, altri: [{ id: "/dev/bus/usb/002/009", nome: "altro", vid: 0x303a, pid: 0x1001, seriale: true, polpo: true }] }), dati: immagineProva(20_000), opzioni: { dispositivo: "/dev/bus/usb/001/002" } });
  assert.equal(r.errore, null, r.errore?.message);
});

test("MD5 diverso dopo la scrittura: errore di verifica, con «scritto»", async () => {
  const { errore } = await prova({ dati: immagineProva(40_000), chipRom: { md5Sbagliato: true } });
  assert.equal(errore?.codice, "verifica", errore?.message);
  assert.equal(errore.scritto, true);
  assert.match(errore.message, /MD5/);
});

test("cavo staccato a metà scrittura: errore «scollegato» con «scritto», nessun reset", async () => {
  let nativo;
  nativo = new NativoUsbFinto({
    chipRom: { stubAtteso: STUB_S3, dopoBlocchi: (n) => n === 3 && nativo.stacca(nativo.voce()) },
  });
  const { errore } = await prova({ nativo, dati: immagineProva(300_000) });
  assert.equal(errore?.codice, "scollegato", errore?.message);
  assert.equal(errore.scritto, true);
  assert.match(errore.message, /durante la scrittura/);
  assert.deepEqual(chiamate(nativo, "serialeLinee"), []);
});

test("annullato prima della scrittura: niente scritto e il Polpo riparte col firmware di prima", async () => {
  const controllo = new AbortController();
  const nativo = new NativoUsbFinto({ chipRom: { stubAtteso: STUB_S3 } });
  const oss = osservatore();
  const errore = await aggiorna({
    nativo,
    firmware: firmwareDi(immagineProva()),
    dati: immagineProva(),
    tempi: TEMPI_PROVA,
    segnale: controllo.signal,
    log: oss.log,
    avanzamento: (a) => a.fase === "preparazione" && controllo.abort(),
  }).catch((e) => e);
  await calma(200);
  assert.equal(errore?.codice, "annullato", errore?.message);
  flashIntatta(nativo.esp);
  assert.deepEqual(nativo.esp.riavvii, ["rom", "app"]);
  assert.equal(nativo.esp.reg(REG.RTC_OPTION1) & 1, 0);
  assert.match(oss.testo(), /riparte con il firmware di prima/);
});

test("annullato mentre aspetta il bootloader", async () => {
  const controllo = new AbortController();
  setTimeout(() => controllo.abort(), 100);
  const { errore } = await prova({ dopoTocco: "sparisce", opzioni: { segnale: controllo.signal } });
  assert.equal(errore?.codice, "annullato");
  assert.match(errore.message, /rimasto nel bootloader/);
});

test("Secure Download Mode: rifiutato", async () => {
  const { errore, esp } = await prova({ chipRom: { sicuro: true } });
  assert.equal(errore?.codice, "download-sicuro", errore?.message);
  flashIntatta(esp);
});

test("ROM con USB-OTG (UARTDEV_BUF_NO 3): blocchi da 2 KB e nessun watchdog da fermare", async () => {
  const dati = immagineProva(50_000);
  const nativo = new NativoUsbFinto({ chipRom: { stubAtteso: STUB_S3, uart: 3 } });
  const { errore, esp } = await prova({ nativo, dati });
  assert.equal(errore, null, errore?.message);
  soloApplicazione(esp, dati);
  assert.ok(!esp.scrittureRegistri.some((x) => x.indirizzo === REG.RTC_WDTCONFIG0));
});

test("firmwareIncluso: legge il file dall'app con risorsaBase64 e ne controlla l'impronta", async () => {
  const dati = immagineProva(10_000);
  const fw = firmwareDi(dati);
  const nativo = new NativoUsbFinto({ risorse: { ["installa/" + fw.app_file]: dati } });
  const r = await firmwareIncluso(nativo, fw);
  assert.equal(r.verificato, true, r.problema);
  assert.ok(Buffer.from(r.dati).equals(Buffer.from(dati)));
  assert.deepEqual(chiamate(nativo), [{ chiamata: "risorsaBase64", percorso: "installa/prova-app.bin" }]);
  const sbagliato = await firmwareIncluso(nativo, { ...fw, sha256: sha256(new Uint8Array(1)) });
  assert.equal(sbagliato.verificato, false);
  assert.match(sbagliato.problema, /impronta/);
  assert.match((await firmwareIncluso(nativo, { ...fw, app_file: "manca.bin" })).problema, /non è incluso/);
  assert.match((await firmwareIncluso(nativo, { ...fw, app_offset: "0x0" })).problema, /solo l'applicazione a 0x10000/);
  assert.match((await firmwareIncluso(nativo, null)).problema, /Nessun firmware/);
});

test("verificaImmagine, leggiIndirizzo, trovaPolpo", async () => {
  const d = new TextEncoder().encode("abc");
  const h = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  assert.equal(await verificaImmagine(d, h), true);
  assert.equal(await verificaImmagine(d, h.toUpperCase()), true);
  assert.equal(await verificaImmagine(d, h.slice(0, 63) + "0"), false);
  assert.equal(await verificaImmagine(d, "abc"), false);
  assert.equal(await verificaImmagine("abc", h), false);
  assert.equal(leggiIndirizzo("0x10000"), 0x10000);
  assert.equal(leggiIndirizzo("65536"), 0x10000);
  assert.equal(leggiIndirizzo(0x10000), 0x10000);
  assert.ok(Number.isNaN(leggiIndirizzo("0x")));
  const polpo = { id: 3, vid: 0x303a, pid: 0x1001, seriale: true, polpo: true };
  assert.equal(trovaPolpo([{ id: 1, vid: 0x1234, seriale: true }, polpo]), polpo);
  assert.throws(() => trovaPolpo([{ id: 1, vid: 0x303a, seriale: false }]), (e) => e.codice === "nessun-polpo");
});
