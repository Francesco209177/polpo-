// Aggiornamento del firmware del Polpo dal telefono, con il cavo USB OTG (Sperimentale: mai provato su un Polpo vero).
//
// È la copia, per l'app per Android, di ciò che fa Polpo Studio sul computer (studio/polpo_studio/devices/firmware.py):
//
//   1. il file è usato solo se la sua impronta SHA-256 è quella fissata nel programma (FIRMWARE.sha256, scritto dalla
//      costruzione del sito in assets/js/studio/firmware-dati.js) e se è l'immagine della sola applicazione per
//      ESP32-S3, non più grande della partizione app0 (0x330000 byte, default_8MB.csv di platformio.ini);
//   2. un «tocco» a 1200 baud (serialeToccoBootloader) fa ripartire l'ESP32-S3 nel bootloader della ROM: il firmware
//      usa la USB nativa (TinyUSB CDC), che a 1200 baud chiama il riavvio nel bootloader;
//   3. il Polpo ricompare (Espressif, VID 0x303A; la ROM usa l'USB-Serial-JTAG, di solito PID 0x1001) entro 8 s, come
//      wait_new_port di Polpo Studio: prima si cerca un dispositivo nuovo, dopo metà del tempo va bene anche quello di
//      prima (succede se il Polpo era già nel bootloader);
//   4. esptool-js (assets/js/terze-parti/esptool-js-0.7.1, copia verificata) parla con la ROM senza alcun reset prima
//      («no_reset»), controlla che il chip sia un ESP32-S3 (altrimenti si ferma senza scrivere niente), carica il suo
//      programma di scrittura (lo «stub», già contenuto nel file di esptool-js: niente viene scaricato), scrive SOLO
//      l'applicazione a 0x10000, compressa, e verifica l'MD5 della memoria scritta;
//   5. reset completo alla fine («hard reset»): il Polpo riparte con il firmware nuovo.
//
// Mai l'immagine completa a 0x0: cancellerebbe le impostazioni salvate (partizione NVS). L'indirizzo è fisso qui.
//
// Rispetto a esptool-js così com'è, questo modulo fa in più tre cose che fa esptool per Python (esptool.py 4.8,
// targets/esp32s3.py) e che esptool-js 0.7.1 non fa per l'ESP32-S3:
//   - spegne il watchdog RTC e fa nutrire da solo il «super watchdog» quando la ROM usa l'USB-Serial-JTAG: altrimenti
//     possono far ripartire il chip a metà scrittura (disable_watchdogs);
//   - prima del reset finale toglie il bit «FORCE_DOWNLOAD_BOOT» di RTC_CNTL_OPTION1, che il tocco a 1200 baud del
//     core Arduino lascia acceso: altrimenti il Polpo ripartirebbe di nuovo nel bootloader (arduino-esp32 #6762);
//   - il reset finale abbassa davvero EN: RTS alto, attesa, RTS basso (la classe HardReset di esptool-js 0.7.1 fa
//     solo «RTS basso», che con l'USB-Serial-JTAG non fa ripartire il chip).
// Inoltre nasconde a esptool-js la funzione getChipRevision che il suo ESP32-S3 eredita dall'ESP32: leggerebbe
// registri dell'ESP32 (0x3FF5A00C, 0x3FF6607C) che sull'ESP32-S3 non esistono. Serve solo per scegliere lo stub
// dell'ESP32-P4, quindi qui non cambia niente. I file di esptool-js restano quelli originali.
//
// Uso (la pagina, dopo la modalità laboratorio e una conferma):
//
//   import { FIRMWARE } from "../firmware-dati.js";
//   const inc = await firmwareIncluso(PolpoNativo, FIRMWARE);   // {dati, verificato, problema}
//   if (inc.verificato) await aggiorna({ nativo: PolpoNativo, firmware: FIRMWARE, dati: inc.dati,
//                                        avanzamento: (a) => ..., log: (riga, livello) => ..., segnale });
//
// `aggiorna` restituisce {versione, byte, md5, chip, mac, flash, ripartito, durata} oppure lancia ErroreAggiornamento
// con un messaggio in italiano per chi usa l'app (`codice` per il programma, `scritto` = la scrittura era cominciata,
// quindi l'applicazione sul Polpo può essere incompleta).

import { ESPLoader, Transport } from "../../terze-parti/esptool-js-0.7.1/bundle.js";
import { ascoltaNativo } from "../link/trasporti.js";
import { daBase64 } from "../link/proto.js";
import { PortaSerialeNativa } from "./porta.js";
import { md5 } from "./md5.js";

/** L'unico indirizzo in cui si scrive: la partizione app0. */
export const INDIRIZZO_APP = 0x10000;
/** Dimensione della partizione app0 (default_8MB.csv: app0, 0x10000, 0x330000). */
export const DIMENSIONE_PARTIZIONE_APP = 0x330000;
export const VID_ESPRESSIF = 0x303a;
export const PID_USB_SERIAL_JTAG = 0x1001;
/** ID del chip nell'intestazione delle immagini e in GET_SECURITY_INFO. */
export const ID_CHIP_ESP32S3 = 9;
export const NOME_CHIP = "ESP32-S3";
const VELOCITA = 115200; // con la USB nativa la velocità non conta: si resta a quella della ROM, senza cambi

/** I tempi (ms). Le prove li accorciano. */
export const TEMPI = Object.freeze({
  tocco: 60000, // risposta a serialeToccoBootloader (Android può chiedere il permesso USB)
  ricomparsa: 8000, // il Polpo che ricompare nel bootloader (come wait_new_port di Polpo Studio)
  controllo: 300, // ogni quanto si rilegge usbElenco() mentre si aspetta
  apertura: 60000, // apertura della porta del bootloader (è un dispositivo nuovo: altro permesso USB)
  ripartenza: 8000, // il Polpo che ricompare dopo la scrittura (solo per il registro)
});

// Registri dell'ESP32-S3 (esptool.py 4.8, targets/esp32s3.py)
const UARTDEV_BUF_NO = 0x3fcef14c; // variabile della ROM: quale porta sta usando
const UARTDEV_BUF_NO_USB_JTAG_SERIAL = 4;
const RTCCNTL_BASE = 0x60008000;
const RTC_CNTL_WDTCONFIG0_REG = RTCCNTL_BASE + 0x98;
const RTC_CNTL_WDTWPROTECT_REG = RTCCNTL_BASE + 0xb0;
const RTC_CNTL_WDT_WKEY = 0x50d83aa1;
const RTC_CNTL_SWD_CONF_REG = RTCCNTL_BASE + 0xb4;
const RTC_CNTL_SWD_AUTO_FEED_EN = 1 << 31;
const RTC_CNTL_SWD_WPROTECT_REG = RTCCNTL_BASE + 0xb8;
const RTC_CNTL_SWD_WKEY = 0x8f1d312a;
const RTC_CNTL_OPTION1_REG = 0x6000812c;
const RTC_CNTL_FORCE_DOWNLOAD_BOOT_MASK = 0x1;

/** Fasi e percentuali di avanzamento (la scrittura è quasi tutto il tempo). */
export const FASI = Object.freeze({
  controllo: [0, 2],
  bootloader: [2, 6],
  collegamento: [6, 9],
  preparazione: [9, 12],
  scrittura: [12, 95],
  verifica: [95, 98],
  riavvio: [98, 100],
});

export class ErroreAggiornamento extends Error {
  /**
   * @param codice per il programma: "ponte", "firmware", "indirizzo", "immagine", "impronta", "nessun-polpo",
   *   "piu-polpo", "tocco", "non-ricomparso", "apertura", "sincronizzazione", "chip", "download-sicuro", "stub",
   *   "flash", "scrittura", "verifica", "scollegato", "annullato"
   * @param messaggio per chi usa l'app, in italiano
   */
  constructor(codice, messaggio, { scritto = false, dettaglio = "" } = {}) {
    super(messaggio);
    this.name = "ErroreAggiornamento";
    this.codice = codice;
    this.scritto = scritto;
    this.dettaglio = dettaglio;
  }
}

const esa = (n, cifre = 0) => "0x" + (n >>> 0).toString(16).padStart(cifre, "0");

/** "0x10000", "65536" o 65536 → numero (NaN se non è un indirizzo). */
export function leggiIndirizzo(x) {
  if (typeof x === "number") return Number.isInteger(x) && x >= 0 ? x : NaN;
  if (typeof x !== "string") return NaN;
  const t = x.trim().toLowerCase();
  if (/^0x[0-9a-f]+$/.test(t)) return parseInt(t.slice(2), 16);
  if (/^[0-9]+$/.test(t)) return parseInt(t, 10);
  return NaN;
}

/** Impronta SHA-256 (WebCrypto) in esadecimale minuscolo. */
export async function impronta(byte) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", byte));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Vero solo se `byte` ha esattamente l'impronta SHA-256 `atteso` (64 cifre esadecimali). */
export async function verificaImmagine(byte, atteso) {
  if (!(byte instanceof Uint8Array) || typeof atteso !== "string" || !/^[0-9a-fA-F]{64}$/.test(atteso)) return false;
  return (await impronta(byte)) === atteso.toLowerCase();
}

/**
 * Controlli sul contenuto, oltre all'impronta: "" se va bene, altrimenti il motivo. L'immagine deve essere quella
 * della sola applicazione (intestazione 0xE9, chip ESP32-S3), non quella completa da scrivere a 0x0, e deve entrare
 * nella partizione app0.
 */
export function controllaImmagine(byte) {
  if (!(byte instanceof Uint8Array) || byte.length === 0) return "Il file del firmware è vuoto o mancante.";
  if (byte.length > DIMENSIONE_PARTIZIONE_APP) {
    return `Il firmware (${byte.length} byte) non entra nella partizione dell'applicazione (${DIMENSIONE_PARTIZIONE_APP} byte).`;
  }
  if (byte.length < 24 || byte[0] !== 0xe9) return "Il file non è un'immagine di firmware per ESP32 (manca l'intestazione 0xE9).";
  if (byte.length > 0x8002 && byte[0x8000] === 0xaa && byte[0x8001] === 0x50) {
    return "Questa è l'immagine completa (da scrivere a 0x0, cancellerebbe le impostazioni): qui si scrive solo l'applicazione.";
  }
  const idChip = byte[12] | (byte[13] << 8);
  if (idChip !== ID_CHIP_ESP32S3) return `L'immagine non è per l'ESP32-S3 del Polpo (chip ${idChip} nell'intestazione).`;
  return "";
}

/**
 * Il firmware incluso nell'app: legge `cartella + firmware.app_file` con risorsaBase64 e ne controlla impronta e
 * contenuto. `firmware` è l'oggetto FIRMWARE di assets/js/studio/firmware-dati.js ({version, app_file, app_offset,
 * sha256}). Risultato: {firmware, dati (Uint8Array o null), verificato, problema ("" se verificato)}.
 */
export async function firmwareIncluso(nativo, firmware, { cartella = "installa/" } = {}) {
  const esito = (dati, problema) => ({ firmware, dati, verificato: !problema, problema });
  if (!firmware || typeof firmware.app_file !== "string" || !firmware.app_file) return esito(null, "Nessun firmware incluso in questa versione dell'app.");
  if (leggiIndirizzo(firmware.app_offset) !== INDIRIZZO_APP) {
    return esito(null, `Il firmware incluso dichiara l'indirizzo ${firmware.app_offset}: si scrive solo l'applicazione a ${esa(INDIRIZZO_APP)}.`);
  }
  if (!nativo || typeof nativo.risorsaBase64 !== "function") return esito(null, "Serve l'app Polpo per Android.");
  let testo = "";
  try {
    testo = nativo.risorsaBase64(cartella + firmware.app_file) || "";
  } catch {
    testo = "";
  }
  if (!testo) return esito(null, `Il file ${firmware.app_file} non è incluso nell'app.`);
  const dati = daBase64(testo);
  if (!dati) return esito(null, `Il file ${firmware.app_file} non si legge.`);
  if (!(await verificaImmagine(dati, firmware.sha256))) return esito(dati, "L'impronta SHA-256 del file è diversa da quella fissata nel programma.");
  const problema = controllaImmagine(dati);
  return esito(dati, problema);
}

/** I dispositivi USB collegati al telefono (usbElenco), [] se il ponte non risponde. */
export function elencoUsb(nativo) {
  try {
    const l = JSON.parse(nativo.usbElenco());
    return Array.isArray(l) ? l : [];
  } catch {
    return [];
  }
}

const espressifSeriale = (d) => d && (d.polpo === true || d.vid === VID_ESPRESSIF) && d.seriale !== false;
const descrivi = (d) =>
  `${d.nome || "dispositivo USB"} (VID ${esa(d.vid ?? 0, 4)}, PID ${esa(d.pid ?? 0, 4)}, ${d.id})`;

/** Il Polpo tra i dispositivi USB: quello con `id`, oppure l'unico dispositivo Espressif con porta seriale. */
export function trovaPolpo(elenco, id = null) {
  const candidati = elenco.filter(espressifSeriale);
  if (id !== null && id !== undefined) {
    const d = candidati.find((x) => String(x.id) === String(id));
    if (!d) throw new ErroreAggiornamento("nessun-polpo", "Il Polpo scelto non è più collegato: ricollegalo con il cavo USB OTG.");
    return d;
  }
  if (!candidati.length) throw new ErroreAggiornamento("nessun-polpo", "Nessun Polpo collegato: collegalo al telefono con il cavo USB OTG.");
  if (candidati.length > 1) throw new ErroreAggiornamento("piu-polpo", "Sono collegati più dispositivi Espressif: lascia collegato solo il Polpo da aggiornare.");
  return candidati[0];
}

const ANNULLATO = "Aggiornamento annullato: sul Polpo non è stato scritto niente.";
const ANNULLATO_NEL_BOOTLOADER = "Aggiornamento annullato: non è stato scritto niente, ma il Polpo può essere rimasto nel bootloader (spegnilo e riaccendilo).";

function annullato(segnale, messaggio = ANNULLATO) {
  if (segnale && segnale.aborted) throw new ErroreAggiornamento("annullato", messaggio);
}

const attesa = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Aspetta un evento del ponte: `prova(ev)` restituisce undefined per continuare, altrimenti il risultato (se è un
 * Error, la promessa viene rifiutata). Con `controlla` (e `ogni` ms) si può anche guardare lo stato senza eventi.
 */
function aspettaNativo({ prova = () => undefined, controlla = null, ogni = 300, tempo, scaduto, segnale, annullamento = ANNULLATO, avvia = null }) {
  return new Promise((risolvi, rifiuta) => {
    let finito = false;
    const fine = (r) => {
      if (finito) return;
      finito = true;
      clearTimeout(timer);
      clearInterval(giro);
      smetti();
      if (segnale) segnale.removeEventListener("abort", suAnnulla);
      if (r instanceof Error) rifiuta(r);
      else risolvi(r);
    };
    const suAnnulla = () => fine(new ErroreAggiornamento("annullato", annullamento));
    const smetti = ascoltaNativo((ev) => {
      let r = prova(ev);
      if (r === undefined && controlla && ev.tipo === "usb.cambiati") r = controlla();
      if (r !== undefined) fine(r);
    });
    const timer = setTimeout(() => fine(scaduto()), tempo);
    const giro = controlla
      ? setInterval(() => {
          const r = controlla();
          if (r !== undefined) fine(r);
        }, ogni)
      : null;
    if (segnale) {
      if (segnale.aborted) return suAnnulla();
      segnale.addEventListener("abort", suAnnulla);
    }
    if (avvia) {
      try {
        const r = avvia();
        if (r !== undefined) fine(r);
      } catch (e) {
        fine(e instanceof Error ? e : new Error(String(e)));
      }
    }
    if (controlla && !finito) {
      const r = controlla();
      if (r !== undefined) fine(r);
    }
  });
}

/** Reset completo come HardReset di esptool.py: RTS alto (EN basso, il chip si ferma), attesa, RTS basso. */
class RiavvioCompleto {
  constructor(transport, usbOtg = false) {
    this.transport = transport;
    this.usbOtg = usbOtg;
  }
  async reset() {
    await this.transport.setRTS(true);
    await attesa(this.usbOtg ? 200 : 100);
    await this.transport.setRTS(false);
    if (this.usbOtg) await attesa(200);
  }
}

/** Le righe che esptool-js scrive sul suo «terminale», una alla volta. */
function terminale(emetti) {
  let resto = "";
  const spezza = (t) => {
    const righe = (resto + t).split(/\r?\n|\r/);
    resto = righe.pop();
    for (const r of righe) if (r.trim()) emetti(r.trim());
  };
  return {
    clean() {},
    write(t) {
      spezza(String(t));
    },
    writeLine(t) {
      spezza(String(t) + "\n");
    },
  };
}

/**
 * Aggiorna il firmware del Polpo collegato al telefono.
 *
 * @param o.nativo PolpoNativo
 * @param o.firmware {version, app_file, app_offset, sha256} (FIRMWARE di firmware-dati.js)
 * @param o.dati Uint8Array con l'immagine dell'applicazione (da firmwareIncluso)
 * @param o.avanzamento facoltativa: ({fase, percento, scritti?, totale?}) a ogni passo; percento da 0 a 100
 * @param o.log facoltativa: (riga, livello) con livello "info", "avviso", "errore" oppure "esptool" (le righe
 *   tecniche di esptool-js, in inglese)
 * @param o.segnale facoltativo AbortSignal: annulla fino all'inizio della scrittura; da lì la scrittura va fino in
 *   fondo (fermarla a metà lascerebbe l'applicazione incompleta)
 * @param o.dispositivo facoltativo: l'id (usbElenco) del Polpo da aggiornare, se ce n'è più di uno
 * @param o.tempi facoltativo: tempi diversi da TEMPI (per le prove)
 */
export async function aggiorna({ nativo, firmware, dati, avanzamento = null, log = null, segnale = null, dispositivo = null, tempi = {} } = {}) {
  const T = { ...TEMPI, ...tempi };
  const inizio = Date.now();
  const scrivi = (riga, livello = "info") => {
    try {
      if (log) log(riga, livello);
    } catch {
      /* il registro non deve fermare l'aggiornamento */
    }
  };
  let ultimo = -1;
  const avanza = (fase, frazione = 0, extra = {}) => {
    const [da, a] = FASI[fase];
    const percento = Math.max(ultimo, Math.min(100, Math.round((da + (a - da) * Math.min(1, Math.max(0, frazione))) * 10) / 10));
    ultimo = percento;
    try {
      if (avanzamento) avanzamento({ fase, percento, ...extra });
    } catch {
      /* come sopra */
    }
  };

  // 1. Controlli, prima di qualsiasi azione sull'USB
  avanza("controllo");
  if (!nativo || typeof nativo.serialeToccoBootloader !== "function" || typeof nativo.usbElenco !== "function") {
    throw new ErroreAggiornamento("ponte", "Serve l'app Polpo per Android con il cavo USB OTG: qui il ponte PolpoNativo non c'è.");
  }
  if (!firmware || typeof firmware.sha256 !== "string") throw new ErroreAggiornamento("firmware", "Manca la descrizione del firmware da scrivere.");
  if (leggiIndirizzo(firmware.app_offset) !== INDIRIZZO_APP) {
    throw new ErroreAggiornamento("indirizzo", `Il firmware dichiara l'indirizzo ${firmware.app_offset}: si scrive solo l'applicazione a ${esa(INDIRIZZO_APP)}.`);
  }
  const problema = controllaImmagine(dati);
  if (problema) throw new ErroreAggiornamento("immagine", problema);
  if (!(await verificaImmagine(dati, firmware.sha256))) {
    throw new ErroreAggiornamento("impronta", "L'impronta SHA-256 del file è diversa da quella fissata nel programma: aggiornamento annullato.");
  }
  const immagine = new Uint8Array(dati); // una copia: nessuno la cambia mentre si scrive
  const versione = String(firmware.version || "?");
  scrivi(`Firmware ${versione}: ${immagine.length} byte, impronta SHA-256 verificata.`);
  avanza("controllo", 1);
  annullato(segnale);

  // 2. Il Polpo e il riavvio nel bootloader
  const elenco = elencoUsb(nativo);
  const polpo = trovaPolpo(elenco, dispositivo);
  scrivi(`Polpo trovato: ${descrivi(polpo)}.`);
  const prima = new Set(elenco.map((d) => String(d.id)));
  try {
    nativo.serialeChiudi(); // una porta per volta: il collegamento Polpo Link va chiuso prima del tocco
  } catch {
    /* nessuna porta aperta */
  }
  scrivi("Riavvio nel bootloader (tocco a 1200 baud)…");
  avanza("bootloader");
  await aspettaNativo({
    prova: (ev) => {
      if (ev.tipo !== "seriale.tocco") return undefined;
      return ev.ok ? true : new ErroreAggiornamento("tocco", `Riavvio nel bootloader non riuscito: ${ev.messaggio || "errore sconosciuto"}.`);
    },
    tempo: T.tocco,
    scaduto: () => new ErroreAggiornamento("tocco", "Il telefono non ha risposto alla richiesta di riavvio nel bootloader."),
    segnale,
    annullamento: ANNULLATO_NEL_BOOTLOADER,
    avvia: () => {
      let r;
      try {
        r = nativo.serialeToccoBootloader(String(polpo.id));
      } catch (e) {
        return new ErroreAggiornamento("tocco", `Riavvio nel bootloader non riuscito: ${e.message || e}.`);
      }
      return r === false ? new ErroreAggiornamento("tocco", "Il telefono ha rifiutato il riavvio nel bootloader.") : undefined;
    },
  });
  avanza("bootloader", 0.3);
  const inizioAttesa = Date.now();
  const rom = await aspettaNativo({
    controlla: () => {
      const esp = elencoUsb(nativo).filter(espressifSeriale);
      const nuovo = esp.find((d) => !prima.has(String(d.id)));
      if (nuovo) return nuovo;
      // come Polpo Studio: dopo metà del tempo va bene anche il dispositivo di prima (Polpo già nel bootloader)
      if (esp.length === 1 && Date.now() - inizioAttesa > T.ricomparsa / 2) return esp[0];
      return undefined;
    },
    ogni: T.controllo,
    tempo: T.ricomparsa,
    scaduto: () =>
      new ErroreAggiornamento(
        "non-ricomparso",
        `Il Polpo non è ricomparso nel bootloader entro ${Math.round(T.ricomparsa / 1000)} s: non è stato scritto niente. Controlla il cavo; se lo schermo resta spento, spegni e riaccendi il Polpo.`,
      ),
    segnale,
    annullamento: ANNULLATO_NEL_BOOTLOADER,
  });
  scrivi(`Bootloader trovato: ${descrivi(rom)}${prima.has(String(rom.id)) ? " (lo stesso dispositivo di prima)" : ""}.`);
  avanza("bootloader", 1);
  annullato(segnale, ANNULLATO_NEL_BOOTLOADER);

  // 3. esptool-js sul bootloader della ROM
  const porta = new PortaSerialeNativa(nativo, rom, { tempoApertura: T.apertura });
  const transport = new Transport(porta, false);
  transport.trace = (m) => scrivi(String(m), "esptool"); // senza questo esptool-js scrive alcune righe in console
  const loader = new ESPLoader({
    transport,
    baudrate: VELOCITA,
    romBaudrate: VELOCITA,
    terminal: terminale((r) => scrivi(r, "esptool")),
    debugLogging: false,
    resetConstructors: { hardReset: (t, usbOtg) => new RiavvioCompleto(t, usbOtg) },
  });

  let fase = "collegamento";
  let scritto = false;
  let chipS3 = false;
  const risultato = { versione, byte: immagine.length, md5: md5(immagine), chip: "", mac: "", flash: "", ripartito: false, durata: 0 };

  const traduci = (e) => {
    if (e instanceof ErroreAggiornamento) return e;
    const dettaglio = String((e && e.message) || e);
    scrivi(`Dettaglio: ${dettaglio}`, "errore");
    if (porta.scollegata) {
      return new ErroreAggiornamento(
        "scollegato",
        scritto
          ? "Il Polpo si è scollegato durante la scrittura: l'applicazione può essere incompleta. Ricollegalo e riprova, oppure reinstalla tutto dalla pagina Installa."
          : "Il Polpo si è scollegato prima della scrittura: sul Polpo non è stato scritto niente.",
        { scritto, dettaglio },
      );
    }
    const nome = e && e.name;
    const messaggi = {
      apertura: ["apertura", `Non riesco ad aprire la porta USB del bootloader: ${dettaglio}`],
      collegamento:
        nome === "UnexpectedChipIdError" || nome === "UnexpectedChipMagicError"
          ? ["chip", "Il chip collegato non è stato riconosciuto: non scrivo niente."]
          : ["sincronizzazione", "Il bootloader non risponde (sincronizzazione non riuscita): sul Polpo non è stato scritto niente. Scollega e ricollega il cavo e riprova; se lo schermo resta spento, spegni e riaccendi il Polpo."],
      preparazione: ["stub", "Il Polpo non ha risposto mentre si preparava la scrittura: non è stato scritto niente."],
      scrittura: ["scrittura", "Scrittura interrotta: l'applicazione sul Polpo è incompleta. Riprova subito l'aggiornamento (il Polpo è rimasto nel bootloader) oppure reinstalla tutto dalla pagina Installa."],
      verifica: ["verifica", "Il controllo dopo la scrittura (MD5) non torna: l'applicazione sul Polpo può essere rovinata. Riprova l'aggiornamento oppure reinstalla tutto dalla pagina Installa."],
    };
    let chiave = fase;
    if (fase === "collegamento" && !porta.apertaUnaVolta) chiave = "apertura";
    if (fase === "verifica" && !/md5/i.test(dettaglio)) chiave = "scrittura";
    const [codice, messaggio] = messaggi[chiave] || ["scrittura", `Aggiornamento non riuscito: ${dettaglio}`];
    return new ErroreAggiornamento(codice, messaggio, { scritto, dettaglio });
  };

  try {
    scrivi("Collegamento al bootloader dell'ESP32-S3…");
    avanza("collegamento");
    await loader.connect("no_reset", 7, true); // apre la porta, sincronizza e riconosce il chip; nessun reset prima
    const nomeChip = loader.chip && loader.chip.CHIP_NAME;
    if (nomeChip !== NOME_CHIP) {
      throw new ErroreAggiornamento("chip", `Il chip collegato è un ${nomeChip || "chip sconosciuto"}, non l'ESP32-S3 del Polpo: non scrivo niente.`);
    }
    chipS3 = true;
    annullato(segnale);
    if (loader.secureDownloadMode) {
      throw new ErroreAggiornamento("download-sicuro", "Il Polpo è in «Secure Download Mode»: da qui non si può aggiornare. Usa la pagina Installa da un computer.");
    }
    // l'ESP32-S3 di esptool-js eredita getChipRevision dall'ESP32 (registri che sull'S3 non esistono): via
    loader.applyDetectedChip(Object.create(loader.chip, { getChipRevision: { value: undefined } }));
    avanza("collegamento", 1);

    fase = "preparazione";
    avanza("preparazione");
    try {
      risultato.chip = await loader.chip.getChipDescription(loader);
      risultato.mac = await loader.chip.readMac(loader);
      scrivi(`Chip: ${risultato.chip}, MAC ${risultato.mac}.`);
    } catch (e) {
      scrivi(`Descrizione del chip non letta (${e.message || e}).`, "avviso");
    }
    await loader.chip.postConnect(loader); // blocchi più piccoli se la ROM usa l'USB-OTG
    const porto = (await loader.readReg(UARTDEV_BUF_NO)) & 0xff;
    if (porto === UARTDEV_BUF_NO_USB_JTAG_SERIAL) {
      // come disable_watchdogs di esptool.py: con l'USB-Serial-JTAG i watchdog RTC non si azzerano da soli
      await loader.writeReg(RTC_CNTL_WDTWPROTECT_REG, RTC_CNTL_WDT_WKEY);
      await loader.writeReg(RTC_CNTL_WDTCONFIG0_REG, 0);
      await loader.writeReg(RTC_CNTL_WDTWPROTECT_REG, 0);
      await loader.writeReg(RTC_CNTL_SWD_WPROTECT_REG, RTC_CNTL_SWD_WKEY);
      await loader.writeReg(RTC_CNTL_SWD_CONF_REG, (await loader.readReg(RTC_CNTL_SWD_CONF_REG)) | RTC_CNTL_SWD_AUTO_FEED_EN);
      await loader.writeReg(RTC_CNTL_SWD_WPROTECT_REG, 0);
      scrivi("Watchdog del chip fermati per la durata della scrittura (USB-Serial-JTAG).");
    }
    annullato(segnale);
    await loader.runStub();
    if (!loader.IS_STUB) throw new ErroreAggiornamento("stub", "Il programma di scrittura (stub) non è partito sul Polpo: non è stato scritto niente.");
    scrivi("Programma di scrittura avviato sul Polpo.");
    const idFlash = await loader.readFlashId();
    if (idFlash === 0xffffff || idFlash === 0) {
      throw new ErroreAggiornamento("flash", `La memoria flash non risponde (ID ${esa(idFlash, 6)}): non scrivo niente.`);
    }
    const dimensione = loader.DETECTED_FLASH_SIZES[(idFlash >> 16) & 0xff];
    if (dimensione) {
      risultato.flash = dimensione;
      const byteFlash = parseInt(dimensione, 10) * (dimensione.endsWith("KB") ? 1024 : 1024 * 1024);
      if (byteFlash < INDIRIZZO_APP + DIMENSIONE_PARTIZIONE_APP) {
        throw new ErroreAggiornamento("flash", `La memoria flash è di ${dimensione}: troppo piccola per il firmware del Polpo. Non scrivo niente.`);
      }
    }
    scrivi(`Memoria flash: ${dimensione || "dimensione sconosciuta"} (ID ${esa(idFlash, 6)}).`);
    avanza("preparazione", 1);
    annullato(segnale); // ultimo punto in cui si può annullare

    // 4. Scrittura: un solo file, all'indirizzo fisso
    fase = "scrittura";
    scritto = true;
    scrivi(`Scrittura dell'applicazione a ${esa(INDIRIZZO_APP)} (non staccare il cavo)…`);
    avanza("scrittura");
    let decimo = -1;
    await loader.writeFlash({
      fileArray: [{ data: immagine, address: INDIRIZZO_APP }],
      flashMode: "keep",
      flashFreq: "keep",
      flashSize: "keep",
      eraseAll: false,
      compress: true,
      calculateMD5Hash: (img) => md5(img),
      reportProgress: (_file, scritti, totale) => {
        const f = totale ? scritti / totale : 1;
        avanza("scrittura", f, { scritti, totale });
        if (Math.floor(f * 10) > decimo) {
          decimo = Math.floor(f * 10);
          if (decimo > 0) scrivi(`Scritto ${decimo * 10}%.`);
        }
        if (totale && scritti >= totale) {
          fase = "verifica"; // dopo l'ultimo blocco esptool-js chiede l'MD5 della memoria scritta
          avanza("verifica");
        }
      },
    });
    scrivi(`Verifica riuscita: l'MD5 della memoria scritta è ${risultato.md5}.`);
    avanza("verifica", 1);

    // 5. Riavvio con il firmware nuovo
    fase = "riavvio";
    avanza("riavvio");
    try {
      await loader.writeReg(RTC_CNTL_OPTION1_REG, 0, RTC_CNTL_FORCE_DOWNLOAD_BOOT_MASK);
    } catch (e) {
      scrivi(`Non ho potuto togliere la richiesta di bootloader (${e.message || e}): se resta nel bootloader, spegni e riaccendi il Polpo.`, "avviso");
    }
    const primaRiavvio = new Set(elencoUsb(nativo).map((d) => String(d.id)));
    scrivi("Riavvio del Polpo…");
    try {
      await loader.after("hard_reset");
    } catch (e) {
      // con la USB nativa il dispositivo può staccarsi subito: va bene
      scrivi(`Il Polpo si è staccato per ripartire (${e.message || e}).`, "esptool");
    }
    await chiudi(transport, porta);
    avanza("riavvio", 0.5);
    try {
      await aspettaNativo({
        controlla: () => (elencoUsb(nativo).some((d) => espressifSeriale(d) && !primaRiavvio.has(String(d.id))) ? true : undefined),
        ogni: T.controllo,
        tempo: T.ripartenza,
        scaduto: () => false,
      }).then((r) => (risultato.ripartito = r === true));
    } catch {
      /* solo per il registro */
    }
    scrivi(
      risultato.ripartito
        ? `Fatto: il Polpo è ripartito con il firmware ${versione}.`
        : `Fatto: firmware ${versione} scritto e verificato. Se lo schermo resta spento, spegni e riaccendi il Polpo.`,
    );
    risultato.durata = Date.now() - inizio;
    avanza("riavvio", 1);
    return risultato;
  } catch (e) {
    let errore = traduci(e);
    if (errore.codice === "annullato" && !chipS3) errore = new ErroreAggiornamento("annullato", ANNULLATO_NEL_BOOTLOADER);
    scrivi(errore.message, "errore");
    // Se non si è scritto niente e il chip è il nostro, si prova a farlo ripartire con il firmware di prima.
    if (!scritto && chipS3 && porta.aperta) {
      try {
        await loader.writeReg(RTC_CNTL_OPTION1_REG, 0, RTC_CNTL_FORCE_DOWNLOAD_BOOT_MASK);
        await loader.after("hard_reset");
        scrivi("Il Polpo riparte con il firmware di prima.");
      } catch {
        scrivi("Il Polpo è rimasto nel bootloader: spegnilo e riaccendilo.", "avviso");
      }
    }
    await chiudi(transport, porta);
    throw errore;
  }
}

/**
 * Chiude la porta. Non con transport.disconnect() di esptool-js: aspetta che nessuno tenga i flussi, ma se una
 * scrittura è fallita (cavo staccato) esptool-js non rilascia il suo scrittore e l'attesa non finirebbe mai. La
 * porta del ponte si può chiudere comunque: basta fermare la lettura di esptool-js.
 */
async function chiudi(transport, porta) {
  try {
    if (porta.readable && porta.readable.locked && transport.reader) await Promise.race([transport.reader.cancel(), attesa(500)]);
  } catch {
    /* lettura già finita */
  }
  try {
    await porta.close();
  } catch {
    /* già chiusa */
  }
}
